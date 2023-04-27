import {
  ClientMessage,
  parseServerMessage,
  ServerMessage,
} from "./protocol.js";

const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_NO_STATUS = 1005;
/** Convex-specific close code representing a "404 Not Found".
 * The edge Onramp accepts websocket upgrades before confirming that the
 * intended destination exists, so this code is sent once we've discovered that
 * the destination does not exist.
 */
const CLOSE_NOT_FOUND = 4040;

type PromisePair<T> = { promise: Promise<T>; resolve: (value: T) => void };

/**
 * The various states our WebSocket can be in:
 *
 * - "disconnected": We don't have a WebSocket, but plan to create one.
 * - "connecting": We have created the WebSocket and are waiting for the
 *   `onOpen` callback.
 * - "ready": We have an open WebSocket.
 * - "closing": We called `.close()` on the WebSocket and are waiting for the
 *   `onClose` callback before we schedule a reconnect.
 * - "stopping": The application decided to totally stop the WebSocket. We are
 *    waiting for the `onClose` callback before we consider this WebSocket stopped.
 * - "pausing": The client needs to fetch some data before it makes sense to resume
 *    the WebSocket connection.
 * - "paused": The WebSocket was stopped and a new one can be created via `.resume()`.
 * - "stopped": We have stopped the WebSocket and will never create a new one.
 *
 *
 * WebSocket State Machine
 * -----------------------
 * initialState: disconnected
 * validTransitions:
 *   disconnected:
 *     new WebSocket() -> connecting
 *     stop() -> stopped
 *   connecting:
 *     onopen -> ready
 *     close() -> closing
 *     stop() -> stopping
 *   ready:
 *     close() -> closing
 *     pause() -> pausing
 *     stop() -> stopping
 *   closing:
 *     onclose -> disconnected
 *     stop() -> stopping
 *   pausing:
 *     onclose -> paused
 *     stop() -> stopping
 *   paused:
 *     resume() -> connecting
 *     stop() -> stopped
 *   stopping:
 *     onclose -> stopped
 * terminalStates:
 *   stopped
 */
type Socket =
  | { state: "disconnected" }
  | { state: "connecting"; ws: WebSocket }
  | { state: "ready"; ws: WebSocket }
  | { state: "closing"; ws: WebSocket }
  | { state: "pausing"; promisePair: PromisePair<null> }
  | { state: "paused" }
  | { state: "stopping"; promisePair: PromisePair<null> }
  | { state: "stopped" };

function promisePair<T>(): PromisePair<T> {
  let resolvePromise: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise! };
}

export type ReconnectMetadata = {
  connectionCount: number;
  lastCloseReason: string | null;
};

/**
 * A wrapper around a websocket that handles errors, reconnection, and message
 * parsing.
 */
export class WebSocketManager {
  private socket: Socket;

  private connectionCount: number;
  private lastCloseReason: string | null;

  /** Upon HTTPS/WSS failure, the first jittered backoff duration, in ms. */
  private readonly initialBackoff: number;

  /** We backoff exponentially, but we need to cap that--this is the jittered max. */
  private readonly maxBackoff: number;

  /** How many times have we failed consecutively? */
  private retries: number;

  /** How long before lack of server response causes us to initiate a reconnect,
   * in ms */
  private readonly serverInactivityThreshold: number;

  private reconnectDueToServerInactivityTimeout: ReturnType<
    typeof setTimeout
  > | null;

  private readonly uri: string;
  private readonly onOpen: (reconnectMetadata: ReconnectMetadata) => void;
  private readonly onMessage: (message: ServerMessage) => void;
  private readonly webSocketConstructor: typeof WebSocket;
  private readonly verbose: boolean;

  constructor(
    uri: string,
    onOpen: (reconnectMetadata: ReconnectMetadata) => void,
    onMessage: (message: ServerMessage) => void,
    webSocketConstructor: typeof WebSocket,
    verbose: boolean
  ) {
    this.webSocketConstructor = webSocketConstructor;
    this.socket = { state: "disconnected" };
    this.connectionCount = 0;
    this.lastCloseReason = "InitialConnect";

    this.initialBackoff = 100;
    this.maxBackoff = 16000;
    this.retries = 0;

    this.serverInactivityThreshold = 30000;
    this.reconnectDueToServerInactivityTimeout = null;

    this.uri = uri;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.verbose = verbose;

    // Kick off connection but don't wait for it.
    void this.connect();
  }

  private async connect() {
    if (
      this.socket.state === "closing" ||
      this.socket.state === "stopping" ||
      this.socket.state === "stopped"
    ) {
      return;
    }
    if (
      this.socket.state !== "disconnected" &&
      this.socket.state !== "paused"
    ) {
      throw new Error(
        "Didn't start connection from disconnected state: " + this.socket.state
      );
    }

    const ws = new this.webSocketConstructor(this.uri);
    this._logVerbose("constructed WebSocket");
    this.socket = {
      state: "connecting",
      ws,
    };
    ws.onopen = () => {
      this._logVerbose("begin ws.onopen");
      if (this.socket.state !== "connecting") {
        throw new Error("onopen called with socket not in connecting state");
      }
      this.socket = { state: "ready", ws };
      this.onServerActivity();
      this.onOpen({
        connectionCount: this.connectionCount,
        lastCloseReason: this.lastCloseReason,
      });

      if (this.lastCloseReason !== "InitialConnect") {
        console.log("WebSocket reconnected");
      }

      this.connectionCount += 1;
      this.lastCloseReason = null;
    };
    // NB: The WebSocket API calls `onclose` even if connection fails, so we can route all error paths through `onclose`.
    ws.onerror = error => {
      const message = (error as ErrorEvent).message;
      console.log(`WebSocket error: ${message}`);
      this.closeAndReconnect("WebSocketError");
    };
    ws.onmessage = message => {
      // TODO(CX-1498): We reset the retry counter on any successful message.
      // This is not ideal and we should improve this further.
      this.retries = 0;
      this.onServerActivity();
      const serverMessage = parseServerMessage(JSON.parse(message.data));
      this._logVerbose(`received ws message with type ${serverMessage.type}`);
      this.onMessage(serverMessage);
    };
    ws.onclose = event => {
      this._logVerbose("begin ws.onclose");
      if (this.lastCloseReason === null) {
        this.lastCloseReason = event.reason ?? "OnCloseInvoked";
      }
      if (
        event.code !== CLOSE_NORMAL &&
        event.code !== CLOSE_GOING_AWAY && // This commonly gets fired on mobile apps when the app is backgrounded
        event.code !== CLOSE_NO_STATUS &&
        event.code !== CLOSE_NOT_FOUND // Note that we want to retry on a 404, as it can be transient during a push.
      ) {
        let msg = `WebSocket closed unexpectedly with code ${event.code}`;
        if (event.reason) {
          msg += `: ${event.reason}`;
        }
        console.error(msg);
      }
      if (this.socket.state === "stopping") {
        this.socket.promisePair.resolve(null);
        this.socket = { state: "stopped" };
        return;
      }
      if (this.socket.state === "pausing") {
        this.socket.promisePair.resolve(null);
        this.socket = { state: "paused" };
        return;
      }
      this.socket = { state: "disconnected" };
      const backoff = this.nextBackoff();
      console.log(`Attempting reconnect in ${backoff}ms`);
      setTimeout(() => this.connect(), backoff);
    };
  }

  /**
   * @returns The state of the {@link Socket}.
   */
  socketState(): string {
    return this.socket.state;
  }

  /**
   * @param message - A ClientMessage to send.
   * @returns Whether the message (might have been) sent.
   */
  sendMessage(message: ClientMessage) {
    this._logVerbose(`sending message with type ${message.type}`);

    if (this.socket.state === "ready") {
      const request = JSON.stringify(message);
      try {
        this.socket.ws.send(request);
      } catch (error: any) {
        console.log(
          `Failed to send message on WebSocket, reconnecting: ${error}`
        );
        this.closeAndReconnect("FailedToSendMessage");
      }
      // We are not sure if this was sent or not.
      return true;
    }
    return false;
  }

  private onServerActivity() {
    if (this.reconnectDueToServerInactivityTimeout !== null) {
      clearTimeout(this.reconnectDueToServerInactivityTimeout);
      this.reconnectDueToServerInactivityTimeout = null;
    }
    this.reconnectDueToServerInactivityTimeout = setTimeout(() => {
      this.closeAndReconnect("InactiveServer");
    }, this.serverInactivityThreshold);
  }

  /**
   * Close the WebSocket and schedule a reconnect when it completes closing.
   *
   * This should be used when we hit an error and would like to restart the session.
   */
  private closeAndReconnect(closeReason: string) {
    this._logVerbose(`begin closeAndReconnect with reason ${closeReason}`);
    switch (this.socket.state) {
      case "disconnected":
      case "closing":
      case "stopping":
      case "stopped":
      case "pausing":
      case "paused":
        // Nothing to do if we don't have a WebSocket.
        return;
      case "connecting":
      case "ready":
        this.lastCloseReason = closeReason;
        this.socket.ws.close();
        this.socket = {
          state: "closing",
          ws: this.socket.ws,
        };
        this._logVerbose("ws.close called");
        return;
      default: {
        // Enforce that the switch-case is exhaustive.
        // eslint-disable-next-line  @typescript-eslint/no-unused-vars
        const _: never = this.socket;
      }
    }
  }

  /**
   * Close the WebSocket and do not reconnect.
   * @returns A Promise that resolves when the WebSocket `onClose` callback is called.
   */
  async stop(): Promise<void> {
    if (this.reconnectDueToServerInactivityTimeout) {
      clearTimeout(this.reconnectDueToServerInactivityTimeout);
    }
    switch (this.socket.state) {
      case "stopped":
        return;
      case "connecting":
      case "ready":
        this.socket.ws.close();
        this.socket = {
          state: "stopping",
          promisePair: promisePair(),
        };
        await this.socket.promisePair.promise;
        return;
      case "pausing":
      case "closing":
        // We're already closing the WebSocket, so just upgrade the state
        // to "stopping" so we don't reconnect.
        this.socket = {
          state: "stopping",
          promisePair: promisePair(),
        };
        await this.socket.promisePair.promise;
        return;
      case "paused":
      case "disconnected":
        // If we're disconnected so switch the state to "stopped" so the reconnect
        // timeout doesn't create a new WebSocket.
        // If we're paused prevent a resume.
        this.socket = { state: "stopped" };
        return;
      case "stopping":
        await this.socket.promisePair.promise;
        return;
      default: {
        // Enforce that the switch-case is exhaustive.
        const _: never = this.socket;
      }
    }
  }

  async pause(): Promise<void> {
    switch (this.socket.state) {
      case "stopping":
      case "stopped":
        // If we're stopping we ignore pause
        return;
      case "paused":
        return;
      case "connecting":
      case "ready":
        this.socket.ws.close();
        this.socket = {
          state: "pausing",
          promisePair: promisePair(),
        };
        await this.socket.promisePair.promise;
        return;
      case "closing":
        // We're already closing the WebSocket, so just upgrade the state
        // to "pausing" so we don't reconnect.
        this.socket = {
          state: "pausing",
          promisePair: promisePair(),
        };
        await this.socket.promisePair.promise;
        return;
      case "disconnected":
        // We're disconnected so switch the state to "paused" so the reconnect
        // timeout doesn't create a new WebSocket.
        this.socket = { state: "paused" };
        return;
      case "pausing":
        await this.socket.promisePair.promise;
        return;
      default: {
        // Enforce that the switch-case is exhaustive.
        const _: never = this.socket;
      }
    }
  }

  /**
   * Create a new WebSocket after a previous `pause()`, unless `stop()` was
   * called before.
   */
  async resume(): Promise<void> {
    switch (this.socket.state) {
      case "pausing":
      case "paused":
        break;
      case "stopping":
      case "stopped":
        // If we're stopping we ignore resume
        return;
      case "connecting":
      case "ready":
      case "closing":
      case "disconnected":
        throw new Error("`resume()` is only valid after `pause()`");
      default: {
        // Enforce that the switch-case is exhaustive.
        const _: never = this.socket;
      }
    }
    if (this.socket.state === "pausing") {
      await this.socket.promisePair.promise;
    }
    await this.connect();
  }

  private _logVerbose(message: string) {
    if (this.verbose) {
      console.debug(`${new Date().toISOString()} ${message}`);
    }
  }

  private nextBackoff(): number {
    const baseBackoff = this.initialBackoff * Math.pow(2, this.retries);
    this.retries += 1;
    const actualBackoff = Math.min(baseBackoff, this.maxBackoff);
    const jitter = actualBackoff * (Math.random() - 0.5);
    return actualBackoff + jitter;
  }
}
