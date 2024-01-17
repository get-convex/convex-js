import * as dotenv from "dotenv";
import { Context } from "../../bundler/context.js";
import { changedEnvVarFile, getEnvVarRegex } from "./envvars.js";

const ENV_VAR_FILE_PATH = ".env.local";
export const CONVEX_DEPLOYMENT_VAR_NAME = "CONVEX_DEPLOYMENT";

export function readDeploymentEnvVar(): string | null {
  dotenv.config({ path: ENV_VAR_FILE_PATH });
  dotenv.config();
  const raw = process.env[CONVEX_DEPLOYMENT_VAR_NAME] ?? null;
  if (raw === null || raw === "") {
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

// Only used in the internal --url flow
export async function eraseDeploymentEnvVar(ctx: Context): Promise<boolean> {
  const existingFile = ctx.fs.exists(ENV_VAR_FILE_PATH)
    ? ctx.fs.readUtf8File(ENV_VAR_FILE_PATH)
    : null;
  if (existingFile === null) {
    return false;
  }
  const config = dotenv.parse(existingFile);
  const existing = config[CONVEX_DEPLOYMENT_VAR_NAME];
  if (existing === undefined) {
    return false;
  }
  const changedFile = existingFile.replace(
    getEnvVarRegex(CONVEX_DEPLOYMENT_VAR_NAME),
    ""
  );
  ctx.fs.writeUtf8File(ENV_VAR_FILE_PATH, changedFile);
  return true;
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
  const commentOnPreviousLine = "# Deployment used by `npx convex dev`";
  const commentAfterValue = `team: ${team}, project: ${project}`;
  return changedEnvVarFile(
    existingFile,
    CONVEX_DEPLOYMENT_VAR_NAME,
    deploymentValue,
    commentAfterValue,
    commentOnPreviousLine
  );
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
