import { Context } from "../../../bundler/context.js";
import {
  DashboardConfig,
  dashboardOutDir,
  loadDashboardConfig,
  loadUuidForAnonymousUser,
  saveDashboardConfig,
} from "./filePaths.js";
import { choosePorts } from "./utils.js";
import { startServer } from "./serve.js";
import { listExistingTryItOutDeployments } from "./tryitout.js";
import { localDeploymentUrl, selfHostedEventTag } from "./run.js";
import serveHandler from "serve-handler";
import { ensureDashboardDownloaded } from "./download.js";
import { bigBrainAPIMaybeThrows } from "../utils/utils.js";

export const DEFAULT_LOCAL_DASHBOARD_PORT = 6790;
export const DEFAULT_LOCAL_DASHBOARD_API_PORT = 6791;

/**
 * This runs the `dashboard-self-hosted` app locally.
 * It's currently just used for the `tryitout` flow, while everything else
 * uses `dashboard.convex.dev`, and some of the code below is written
 * assuming this is only used for `tryitout`.
 */
export async function handleDashboard(ctx: Context, version: string) {
  const config = loadDashboardConfig(ctx);
  const anonymousId = loadUuidForAnonymousUser(ctx) ?? undefined;
  if (config !== null) {
    const isRunning = await checkIfDashboardIsRunning(config);
    if (isRunning) {
      // It's possible this is running with a different version, but
      // let's not worry about that for now.
      return;
    }
  }
  await ensureDashboardDownloaded(ctx, version);
  const [dashboardPort, apiPort] = await choosePorts(ctx, {
    count: 2,
    startPort: DEFAULT_LOCAL_DASHBOARD_PORT,
    requestedPorts: [null, null],
  });
  await saveDashboardConfig(ctx, {
    port: dashboardPort,
    apiPort,
    version,
  });

  let hasReportedSelfHostedEvent = false;

  const { cleanupHandle } = await startServer(
    ctx,
    dashboardPort,
    async (request, response) => {
      if (!hasReportedSelfHostedEvent) {
        hasReportedSelfHostedEvent = true;
        void reportSelfHostedEvent(ctx, {
          anonymousId,
          eventName: "self_host_dashboard_connected",
          tag: selfHostedEventTag("tryItOut"),
        });
      }
      await serveHandler(request, response, {
        public: dashboardOutDir(),
      });
    },
    {},
  );
  await startServingListDeploymentsApi(ctx, apiPort);
  return {
    dashboardPort,
    cleanupHandle,
  };
}

async function reportSelfHostedEvent(
  ctx: Context,
  {
    anonymousId,
    eventName,
    eventFields,
    tag,
  }: {
    anonymousId: string | undefined;
    eventName: string;
    eventFields?: Record<string, unknown>;
    tag: string | undefined;
  },
) {
  try {
    await bigBrainAPIMaybeThrows({
      ctx,
      method: "POST",
      url: "/api/self_hosted_event",
      data: {
        selfHostedUuid: anonymousId,
        eventName,
        eventFields,
        tag,
      },
    });
  } catch {
    // ignore
  }
}

/**
 * This serves a really basic API that just returns a JSON blob with the deployments
 * and their credentials.
 * The locally running dashboard can hit this API.
 */
async function startServingListDeploymentsApi(ctx: Context, port: number) {
  await startServer(
    ctx,
    port,
    async (request, response) => {
      const deployments = await listExistingTryItOutDeployments(ctx);
      const deploymentsJson = deployments.map((d) => ({
        name: d.deploymentName,
        url: localDeploymentUrl(d.config.ports.cloud),
        adminKey: d.config.adminKey,
      }));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ deployments: deploymentsJson }));
    },
    {
      cors: true,
    },
  );
}

export async function checkIfDashboardIsRunning(config: DashboardConfig) {
  // We're checking if the mini API server is running and has a response that
  // looks like a list of deployments, since it's easier than checking the
  // dashboard UI.
  let resp: Response;
  try {
    resp = await fetch(`http://127.0.0.1:${config.apiPort}`);
  } catch {
    return false;
  }
  if (!resp.ok) {
    return false;
  }
  let data: { deployments: { name: string; url: string; adminKey: string }[] };
  try {
    data = await resp.json();
  } catch {
    return false;
  }
  return Array.isArray(data.deployments);
}
