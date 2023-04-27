import { jsonToConvex } from "../../values/index.js";
import { logToConsole } from "../logging.js";
import { Long } from "../long.js";
import { FunctionResult } from "./function_result.js";
import {
  ActionRequest,
  ActionResponse,
  ClientMessage,
  MutationRequest,
  MutationResponse,
  RequestId,
} from "./protocol.js";

type RequestStatus =
  | {
      status: "Requested" | "NotSent";
      onResult: (result: FunctionResult) => void;
      requestedAt: Date;
    }
  | {
      status: "Completed";
      onResolve: () => void;
      ts: Long;
    };

export class RequestManager {
  private inflightRequests: Map<
    RequestId,
    {
      message: MutationRequest | ActionRequest;
      status: RequestStatus;
    }
  >;
  private _timeOfOldestInflightRequest: null | Date;
  constructor() {
    this.inflightRequests = new Map();
    this._timeOfOldestInflightRequest = null;
  }

  request(
    message: MutationRequest | ActionRequest,
    sent: boolean
  ): Promise<FunctionResult> {
    const result = new Promise<FunctionResult>(resolve => {
      const status = sent ? "Requested" : "NotSent";
      this.inflightRequests.set(message.requestId, {
        message,
        status: { status, requestedAt: new Date(), onResult: resolve },
      });
    });

    return result;
  }

  /**
   * Update the state after receiving a response.
   *
   * @returns A RequestId if the request is complete and its optimistic update
   * can be dropped, null otherwise.
   */
  onResponse(response: MutationResponse | ActionResponse): RequestId | null {
    const requestInfo = this.inflightRequests.get(response.requestId);
    if (requestInfo === undefined) {
      // Annoyingly we can occasionally get responses to mutations that we're no
      // longer tracking. One flow where this happens is:
      // 1. Client sends mutation 1
      // 2. Client gets response for mutation 1. The sever says that it was committed at ts=10.
      // 3. Client is disconnected
      // 4. Client reconnects and re-issues queries and this mutation.
      // 5. Server sends transition message to ts=20
      // 6. Client drops mutation because it's already been observed.
      // 7. Client receives a second response for mutation 1 but doesn't know about it anymore.

      // The right fix for this is probably to add a reconciliation phase on
      // reconnection where we receive responses to all the mutations before
      // the transition message so this flow could never happen (CX-1513).

      // For now though, we can just ignore this message.
      return null;
    }

    // Because `.restart()` re-requests completed requests, we may get some
    // responses for requests that are already in the "Completed" state.
    // We can safely ignore those because we've already notified the UI about
    // their results.
    if (requestInfo.status.status === "Completed") {
      return null;
    }

    const udfType =
      requestInfo.message.type === "Mutation" ? "mutation" : "action";
    const udfPath = requestInfo.message.udfPath;

    for (const line of response.logLines) {
      logToConsole("info", udfType, udfPath, line);
    }

    const status = requestInfo.status;
    let onResolve;
    if (response.success) {
      onResolve = () =>
        status.onResult({
          success: true,
          logLines: response.logLines,
          value: jsonToConvex(response.result),
        });
    } else {
      logToConsole("error", udfType, udfPath, response.result);
      onResolve = () =>
        status.onResult({
          success: false,
          errorMessage: response.result,
          logLines: response.logLines,
        });
    }

    // We can resolve Mutation failures immediately since they don't have any
    // side effects.
    // TODO(presley): Add timestamp to ActionResponse so the client can read
    // its own writes on the happy path.
    if (response.type === "ActionResponse" || !response.success) {
      onResolve();
      this.inflightRequests.delete(response.requestId);
      return response.requestId;
    }

    // We have to wait to resolve the request promise until after we transition
    // past this timestamp so clients can read their own writes.
    requestInfo.status = {
      status: "Completed",
      ts: response.ts,
      onResolve,
    };

    return null;
  }

  // Remove and returns completed requests.
  removeCompleted(ts: Long): Set<RequestId> {
    const completeRequests: Set<RequestId> = new Set();
    for (const [requestId, requestInfo] of this.inflightRequests.entries()) {
      const status = requestInfo.status;
      if (status.status === "Completed" && status.ts.lessThanOrEqual(ts)) {
        status.onResolve();
        completeRequests.add(requestId);
        this.inflightRequests.delete(requestId);
      }
    }
    return completeRequests;
  }

  restart(): ClientMessage[] {
    // When we reconnect to the backend, re-request all requests that are safe
    // to be resend.

    const allMessages = [];
    for (const [requestId, value] of this.inflightRequests) {
      if (value.status.status === "NotSent") {
        value.status.status = "Requested";
        allMessages.push(value.message);
        continue;
      }

      if (value.message.type === "Mutation") {
        // This includes ones that have already been completed because we still
        // want to tell the backend to transition the client past the completed
        // timestamp. This is safe since mutations are idempotent.
        allMessages.push(value.message);
      } else {
        // Unlike mutations, actions are not idempotent. When we reconnect to the
        // backend, we don't know if it is safe to resend in-flight actions, so we
        // cancel them and consider them failed.
        this.inflightRequests.delete(requestId);
        if (value.status.status === "Completed") {
          throw new Error("Action should never be in 'Completed' state");
        }
        value.status.onResult({
          success: false,
          errorMessage: "Connection lost while action was in flight",
          logLines: [],
        });
      }
    }
    return allMessages;
  }

  /**
   ** @returns true if there are any requests that have been requested but have
   ** not be completed yet.
   **/
  hasIncompleteRequests(): boolean {
    for (const requestInfo of this.inflightRequests.values()) {
      if (requestInfo.status.status === "Requested") {
        return true;
      }
    }
    return false;
  }

  /**
   ** @returns true if there are any inflight requests, including ones that have
   ** completed on the server, but have not been applied.
   **/
  hasInflightRequests(): boolean {
    return this.inflightRequests.size > 0;
  }

  timeOfOldestInflightRequest(): Date | null {
    if (this.inflightRequests.size === 0) {
      return null;
    }
    let oldestInflightRequest = Date.now();
    for (const request of this.inflightRequests.values()) {
      if (request.status.status !== "Completed") {
        if (request.status.requestedAt.getTime() < oldestInflightRequest) {
          oldestInflightRequest = request.status.requestedAt.getTime();
        }
      }
    }
    return new Date(oldestInflightRequest);
  }
}
