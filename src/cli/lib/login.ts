import { errors, BaseClient, custom } from "openid-client";
import {
  globalConfigPath,
  rootDirectory,
  GlobalConfig,
  getAuthHeader,
  bigBrainAPI,
  logAndHandleAxiosError,
} from "./utils.js";
import open from "open";
import chalk from "chalk";
import { provisionHost } from "./config.js";
import { version } from "../../index.js";
import axios, { AxiosRequestConfig } from "axios";
import {
  Context,
  changeSpinner,
  logError,
  logFailure,
  logFinishedStep,
  showSpinner,
} from "./context.js";
import { Issuer } from "openid-client";
import inquirer from "inquirer";
import { hostname } from "os";
import { execSync } from "child_process";
import os from "os";

const SCOPE = "openid email profile";

// Per https://github.com/panva/node-openid-client/tree/main/docs#customizing
custom.setHttpOptionsDefaults({
  timeout: 10000,
});

async function writeGlobalConfig(ctx: Context, config: GlobalConfig) {
  const dirName = rootDirectory();
  ctx.fs.mkdir(dirName, { allowExisting: true });
  const path = globalConfigPath();
  try {
    ctx.fs.writeUtf8File(path, JSON.stringify(config));
  } catch (err) {
    logFailure(
      ctx,
      chalk.red(`Failed to write auth config to ${path} with error: ${err}`)
    );
    return await ctx.crash(1, "invalid filesystem data", err);
  }
  logFinishedStep(ctx, `Saved credentials to ${formatPathForPrinting(path)}`);
}

function formatPathForPrinting(path: string) {
  const homedir = os.homedir();
  if (process.platform === "darwin" && path.startsWith(homedir)) {
    return path.replace(homedir, "~");
  }
  return path;
}

export async function checkAuthorization(ctx: Context): Promise<boolean> {
  const header = await getAuthHeader(ctx);
  if (!header) {
    return false;
  }
  try {
    const resp = await axios.head(`${provisionHost}/api/authorize`, {
      headers: {
        Authorization: header,
        "Convex-Client": `npm-cli-${version}`,
      },
      // Don't throw an error if this request returns a non-200 status.
      // Big Brain responds with a variety of error codes -- 401 if the token is correctly-formed but not valid, and either 400 or 500 if the token is ill-formed.
      // We only care if this check returns a 200 code (so we can skip logging in again) -- any other errors should be silently skipped and we'll run the whole login flow again.
      validateStatus: _ => true,
    });
    if (resp.status !== 200) {
      return false;
    }
  } catch (e: any) {
    // This `catch` block should only be hit if a network error was encountered and axios didn't receive any sort of response.
    logError(
      ctx,
      `Unexpected error when authorizing - are you connected to the internet?`
    );
    return await logAndHandleAxiosError(ctx, e);
  }

  // Check that we have optin as well
  const shouldContinue = await optins(ctx);
  if (!shouldContinue) {
    return await ctx.crash(1, undefined);
  }
  return true;
}

async function performDeviceAuthorization(
  ctx: Context,
  auth0Client: BaseClient,
  shouldOpen: boolean
): Promise<string> {
  // Device authorization flow follows this guide: https://github.com/auth0/auth0-device-flow-cli-sample/blob/9f0f3b76a6cd56ea8d99e76769187ea5102d519d/cli.js
  // License: MIT License
  // Copyright (c) 2019 Auth0 Samples
  /*
  The MIT License (MIT)

  Copyright (c) 2019 Auth0 Samples

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  */

  // Device Authorization Request - https://tools.ietf.org/html/rfc8628#section-3.1
  // Get authentication URL
  let handle;
  try {
    handle = await auth0Client.deviceAuthorization({
      scope: SCOPE,
      audience: "https://console.convex.dev/api/",
    });
  } catch (error) {
    // We couldn't get verification URL from Auth0, proceed with manual auth
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "authToken",
        message:
          "Open https://dash.convex.dev/auth, log in and paste the token here:",
      },
    ]);
    return answers.authToken;
  }

  // Device Authorization Response - https://tools.ietf.org/html/rfc8628#section-3.2
  // Open authentication URL
  const { verification_uri_complete, user_code, expires_in } = handle;
  console.log(`Visit ${verification_uri_complete} to finish logging in.`);
  console.log(
    `You should see the following code which expires in ${
      expires_in % 60 === 0
        ? `${expires_in / 60} minutes`
        : `${expires_in} seconds`
    }: ${user_code}`
  );
  if (shouldOpen) {
    shouldOpen = (
      await inquirer.prompt([
        {
          name: "openBrowser",
          message: `Open the browser?`,
          type: "confirm",
          default: true,
        },
      ])
    ).openBrowser;
  }

  if (shouldOpen) {
    showSpinner(
      ctx,
      `Opening ${verification_uri_complete} in your browser to log in...\n`
    );
    try {
      await open(verification_uri_complete);
      changeSpinner(ctx, "Waiting for the confirmation...");
    } catch (err: any) {
      logError(ctx, chalk.red(`Unable to open browser.`));
      changeSpinner(
        ctx,
        `Manually open ${verification_uri_complete} in your browser to log in.`
      );
    }
  } else {
    showSpinner(
      ctx,
      `Open ${verification_uri_complete} in your browser to log in.`
    );
  }

  // Device Access Token Request - https://tools.ietf.org/html/rfc8628#section-3.4
  // Device Access Token Response - https://tools.ietf.org/html/rfc8628#section-3.5
  try {
    const tokens = await handle.poll();
    if (typeof tokens.access_token === "string") {
      return tokens.access_token;
    } else {
      throw Error("Access token is missing");
    }
  } catch (err: any) {
    switch (err.error) {
      case "access_denied": // end-user declined the device confirmation prompt, consent or rules failed
        logFailure(ctx, "Access denied.");
        return await ctx.crash(1, err);
      case "expired_token": // end-user did not complete the interaction in time
        logFailure(ctx, "Device flow expired.");
        return await ctx.crash(1, err);
      default:
        if (err instanceof errors.OPError) {
          logFailure(
            ctx,
            `Error = ${err.error}; error_description = ${err.error_description}`
          );
        } else {
          logFailure(ctx, `Login failed with error: ${err}`);
        }
        return await ctx.crash(1, err);
    }
  }
}

async function performPasswordAuthentication(
  ctx: Context,
  issuer: string,
  clientId: string,
  username: string,
  password: string
): Promise<string> {
  // Unfortunately, `openid-client` doesn't support the resource owner password credentials flow so we need to manually send the requests.
  const options: AxiosRequestConfig = {
    method: "POST",
    url: new URL("/oauth/token", issuer).href,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: new URLSearchParams({
      grant_type: "password",
      username: username,
      password: password,
      scope: SCOPE,
      client_id: clientId,
      audience: "https://console.convex.dev/api/",
      // Note that there is no client secret provided, as Auth0 refuses to require it for untrusted apps.
    }),
  };

  try {
    const response = await axios.request(options);
    if (typeof response.data.access_token === "string") {
      return response.data.access_token;
    } else {
      throw Error("Access token is missing");
    }
  } catch (err: any) {
    console.log(`Password flow failed: ${err}`);
    if (err.response) {
      console.log(`${JSON.stringify(err.response.data)}`);
    }
    return await ctx.crash(1, err);
  }
}

export async function performLogin(
  ctx: Context,
  {
    overrideAuthUrl,
    overrideAuthClient,
    overrideAuthUsername,
    overrideAuthPassword,
    open,
    optIn,
    deviceName: deviceNameOverride,
  }: {
    overrideAuthUrl?: string;
    overrideAuthClient?: string;
    overrideAuthUsername?: string;
    overrideAuthPassword?: string;
    // default `true`
    open?: boolean;
    // default `true`
    optIn?: boolean;
    deviceName?: string;
  } = {}
) {
  // Get access token from big-brain
  // Default the device name to the hostname, but allow the user to change this if the terminal is interactive.
  // On Macs, the `hostname()` may be a weirdly-truncated form of the computer name. Attempt to read the "real" name before falling back to hostname.
  let deviceName = deviceNameOverride ?? "";
  if (!deviceName && process.platform === "darwin") {
    try {
      deviceName = execSync("scutil --get ComputerName").toString().trim();
    } catch {
      // Just fall back to the hostname default below.
    }
  }
  if (!deviceName) {
    deviceName = hostname();
  }
  if (process.stdin.isTTY && !deviceNameOverride) {
    console.log(
      chalk.bold(`Welcome to developing with Convex, let's get you logged in.`)
    );
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "deviceName",
        message: "Device name:",
        default: deviceName,
      },
    ]);
    deviceName = answers.deviceName;
  }

  const issuer = overrideAuthUrl ?? "https://auth.convex.dev";
  const auth0 = await Issuer.discover(issuer);
  const clientId = overrideAuthClient ?? "HFtA247jp9iNs08NTLIB7JsNPMmRIyfi";
  const auth0Client = new auth0.Client({
    client_id: clientId,
    token_endpoint_auth_method: "none",
    id_token_signed_response_alg: "RS256",
  });

  let accessToken: string;
  if (overrideAuthUsername && overrideAuthPassword) {
    accessToken = await performPasswordAuthentication(
      ctx,
      issuer,
      clientId,
      overrideAuthUsername,
      overrideAuthPassword
    );
  } else {
    accessToken = await performDeviceAuthorization(
      ctx,
      auth0Client,
      open ?? true
    );
  }
  interface AuthorizeArgs {
    authnToken: string;
    deviceName: string;
  }
  const authorizeArgs: AuthorizeArgs = {
    authnToken: accessToken,
    deviceName: deviceName,
  };
  const data = await bigBrainAPI(ctx, "POST", "authorize", authorizeArgs);
  const globalConfig = { accessToken: data.accessToken };
  try {
    await writeGlobalConfig(ctx, globalConfig);
  } catch (err: any) {
    return await ctx.crash(1, "invalid filesystem data", err);
  }

  if (optIn ?? true) {
    // Do opt in to TOS and Privacy Policy stuff
    const shouldContinue = await optins(ctx);
    if (!shouldContinue) {
      return await ctx.crash(1, undefined);
    }
  }
}

/// There are fields like version, but we keep them opaque
type OptIn = Record<string, unknown>;

type OptInToAccept = {
  optIn: OptIn;
  message: string;
};

type AcceptOptInsArgs = {
  optInsAccepted: OptIn[];
};

// Returns whether we can proceed or not.
async function optins(ctx: Context): Promise<boolean> {
  const data = await bigBrainAPI(ctx, "POST", "check_opt_ins", {});
  if (data.optInsToAccept.length === 0) {
    return true;
  }
  for (const optInToAccept of data.optInsToAccept) {
    const confirmed = (
      await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: optInToAccept.message,
        },
      ])
    ).confirmed;

    if (!confirmed) {
      console.log("Please accept the Terms of Service to use Convex.");
      return Promise.resolve(false);
    }
  }

  const optInsAccepted = data.optInsToAccept.map((o: OptInToAccept) => o.optIn);
  const args: AcceptOptInsArgs = { optInsAccepted };
  await bigBrainAPI(ctx, "POST", "accept_opt_ins", args);
  return true;
}
