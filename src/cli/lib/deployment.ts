import * as dotenv from "dotenv";
import { Context } from "../../bundler/context.js";

const ENV_VAR_FILE_PATH = ".env.local";
export const CONVEX_DEPLOYMENT_VAR_NAME = "CONVEX_DEPLOYMENT";
const ENV_VAR_REGEX = new RegExp(`^${CONVEX_DEPLOYMENT_VAR_NAME}.*$`, "m");

export function readDeploymentEnvVar(): string | null {
  dotenv.config({ path: ENV_VAR_FILE_PATH });
  dotenv.config();
  const raw = process.env[CONVEX_DEPLOYMENT_VAR_NAME] ?? null;
  if (raw === null) {
    return null;
  }
  return stripDeploymentTypePrefix(raw);
}

// Given a deployment string like "dev:tall-forest-1234"
// returns only the slug "tall-forest-1234".
// If there's no prefix returns the original string.
export function stripDeploymentTypePrefix(deployment: string) {
  return deployment.split(":").at(-1)!;
}

export async function writeDeploymentEnvVar(
  ctx: Context,
  deploymentType: "dev" | "prod",
  deployment: { team: string; project: string; deploymentName: string }
): Promise<{ wroteToGitIgnore: boolean }> {
  const existingFile = ctx.fs.exists(ENV_VAR_FILE_PATH)
    ? ctx.fs.readUtf8File(ENV_VAR_FILE_PATH)
    : null;
  const changedFile = changesToEnvVarFile(
    existingFile,
    deploymentType,
    deployment
  );
  if (changedFile !== null) {
    ctx.fs.writeUtf8File(ENV_VAR_FILE_PATH, changedFile);
    // Only do this if we're not reinitializing an existing setup
    return { wroteToGitIgnore: await gitIgnoreEnvVarFile(ctx) };
  }
  return { wroteToGitIgnore: false };
}

async function gitIgnoreEnvVarFile(ctx: Context): Promise<boolean> {
  const gitIgnorePath = ".gitignore";
  const gitIgnoreContents = ctx.fs.exists(gitIgnorePath)
    ? ctx.fs.readUtf8File(gitIgnorePath)
    : "";
  const changedGitIgnore = changesToGitIgnore(gitIgnoreContents);
  if (changedGitIgnore !== null) {
    ctx.fs.writeUtf8File(gitIgnorePath, changedGitIgnore);
    return true;
  }
  return false;
}

// exported for tests
export function changesToEnvVarFile(
  existingFile: string | null,
  deploymentType: "dev" | "prod",
  {
    team,
    project,
    deploymentName,
  }: { team: string; project: string; deploymentName: string }
): string | null {
  const deploymentValue = deploymentType + ":" + deploymentName;
  const comment = "# Deployment used by `npx convex dev`";
  const varAssignment = `${CONVEX_DEPLOYMENT_VAR_NAME}=${deploymentValue} # team: ${team}, project: ${project}`;
  if (existingFile === null) {
    return `${comment}\n${varAssignment}\n`;
  }
  const config = dotenv.parse(existingFile);
  const existing = config[CONVEX_DEPLOYMENT_VAR_NAME];
  if (existing === deploymentValue) {
    return null;
  }
  if (existing !== undefined) {
    return existingFile.replace(ENV_VAR_REGEX, `${varAssignment}`);
  } else {
    return `${existingFile}\n${comment}\n${varAssignment}\n`;
  }
}

// exported for tests
export function changesToGitIgnore(existingFile: string | null): string | null {
  if (existingFile === null) {
    return `${ENV_VAR_FILE_PATH}\n`;
  }
  const gitIgnoreLines = existingFile.split("\n");
  const envVarFileIgnored = gitIgnoreLines.some(
    (line) =>
      line === ".env.local" ||
      line === ".env.*" ||
      line === ".env*" ||
      line === "*.local" ||
      line === ".env*.local"
  );
  if (!envVarFileIgnored) {
    return `${existingFile}\n${ENV_VAR_FILE_PATH}\n`;
  } else {
    return null;
  }
}
