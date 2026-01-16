import { BigBrainAuth, Context, ErrorType } from "../../../bundler/context.js";
import { Filesystem, nodeFs } from "../../../bundler/fs.js";
import { Ora } from "ora";
import {
  DeploymentSelectionWithinProject,
  deploymentSelectionWithinProjectSchema,
  DeploymentSelectionOptions,
} from "../api.js";
import {
  DeploymentSelection,
  getDeploymentSelection,
} from "../deploymentSelection.js";
import { z } from "zod";

export interface McpOptions extends DeploymentSelectionOptions {
  projectDir?: string;
  disableTools?: string;
  dangerouslyEnableProductionDeployments?: boolean;
}

export class RequestContext implements Context {
  fs: Filesystem;
  deprecationMessagePrinted = false;
  spinner: Ora | undefined;
  _cleanupFns: Record<string, (exitCode: number, err?: any) => Promise<void>> =
    {};
  _bigBrainAuth: BigBrainAuth | null = null;
  constructor(public options: McpOptions) {
    this.fs = nodeFs;
    this.deprecationMessagePrinted = false;
  }

  async crash(args: {
    exitCode: number;
    errorType?: ErrorType;
    errForSentry?: any;
    printedMessage: string | null;
  }): Promise<never> {
    const cleanupFns = this._cleanupFns;
    this._cleanupFns = {};
    for (const fn of Object.values(cleanupFns)) {
      await fn(args.exitCode, args.errForSentry);
    }
    // eslint-disable-next-line no-restricted-syntax
    throw new RequestCrash(args.exitCode, args.errorType, args.printedMessage);
  }

  flushAndExit() {
    // eslint-disable-next-line no-restricted-syntax
    throw new Error("Not implemented");
  }

  registerCleanup(fn: (exitCode: number, err?: any) => Promise<void>): string {
    const handle = crypto.randomUUID();
    this._cleanupFns[handle] = fn;
    return handle;
  }

  removeCleanup(handle: string) {
    const value = this._cleanupFns[handle];
    delete this._cleanupFns[handle];
    return value ?? null;
  }

  bigBrainAuth(): BigBrainAuth | null {
    return this._bigBrainAuth;
  }

  _updateBigBrainAuth(auth: BigBrainAuth | null): void {
    this._bigBrainAuth = auth;
  }

  async decodeDeploymentSelector(encoded: string) {
    const { projectDir, deployment } = decodeDeploymentSelector(encoded);
    if (
      deployment.kind === "prod" &&
      !this.options.dangerouslyEnableProductionDeployments
    ) {
      return await this.crash({
        exitCode: 1,
        errorType: "fatal",
        printedMessage:
          "Production deployments are disabled due to the --disable-production-deployments flag.",
      });
    }
    return { projectDir, deployment };
  }

  get productionDeploymentsDisabled() {
    return !this.options.dangerouslyEnableProductionDeployments;
  }

  /**
   * Determine if BigBrain (Convex Cloud) authentication is required for the
   * current deployment configuration.
   *
   * BigBrain authentication is NOT required for:
   * - Self-hosted deployments (CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY)
   * - CLI-specified URL and admin key (--url + --admin-key)
   * - Anonymous local development mode
   *
   * BigBrain authentication IS required for:
   * - Cloud-hosted project deployments
   * - Preview deployments
   * - Deploy key-based deployments (needs BigBrain to resolve deployment info)
   * - Interactive project selection
   */
  async requiresBigBrainAuth(): Promise<boolean> {
    // If URL and adminKey are directly specified via CLI, no BigBrain auth needed
    if (this.options.url !== undefined && this.options.adminKey !== undefined) {
      return false;
    }

    try {
      const deploymentSelection = await getDeploymentSelection(this, this.options);
      return requiresBigBrainAuthForDeployment(deploymentSelection);
    } catch {
      // If we can't determine deployment type, conservatively require auth
      return true;
    }
  }
}

export class RequestCrash {
  printedMessage: string;
  constructor(
    private exitCode: number,
    private errorType: ErrorType | undefined,
    printedMessage: string | null,
  ) {
    this.printedMessage = printedMessage ?? "Unknown error";
  }
}

// Unfortunately, MCP clients don't seem to handle nested JSON objects very
// well (even though this is within spec). To work around this, encode the
// deployment selectors as an obfuscated string that the MCP client can
// opaquely pass around.
export function encodeDeploymentSelector(
  projectDir: string,
  deployment: DeploymentSelectionWithinProject,
) {
  const payload = {
    projectDir,
    deployment,
  };
  return `${deployment.kind}:${btoa(JSON.stringify(payload))}`;
}

const payloadSchema = z.object({
  projectDir: z.string(),
  deployment: deploymentSelectionWithinProjectSchema,
});

function decodeDeploymentSelector(encoded: string) {
  const [_, serializedPayload] = encoded.split(":");
  return payloadSchema.parse(JSON.parse(atob(serializedPayload)));
}

/**
 * Determine if BigBrain authentication is required for a given deployment selection.
 *
 * @param deploymentSelection - The deployment selection to check
 * @returns true if BigBrain auth is required, false otherwise
 */
export function requiresBigBrainAuthForDeployment(
  deploymentSelection: DeploymentSelection,
): boolean {
  switch (deploymentSelection.kind) {
    case "existingDeployment":
      // Self-hosted and CLI-specified deployments don't need BigBrain auth
      // Deploy keys still need BigBrain to resolve deployment info
      return deploymentSelection.deploymentToActOn.source === "deployKey";

    case "anonymous":
      // Anonymous local development doesn't need BigBrain auth
      return false;

    case "deploymentWithinProject":
    case "preview":
    case "chooseProject":
      // Cloud-hosted deployments require BigBrain auth
      return true;

    default:
      // Unknown type, conservatively require auth
      return true;
  }
}
