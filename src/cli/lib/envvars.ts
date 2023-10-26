/**
 * Help the developer store the CONVEX_URL environment variable.
 */
import chalk from "chalk";
import * as dotenv from "dotenv";

import { Context, logWarning } from "../../bundler/context.js";
import { loadPackageJson } from "./utils.js";

const FRAMEWORKS = [
  "create-react-app",
  "Next.js",
  "Vite",
  "Remix",
  "SvelteKit",
] as const;
type Framework = (typeof FRAMEWORKS)[number];

type ConvexUrlWriteConfig = {
  envFile: string;
  envVar: string;
  oldValue?: string;
} | null;

export async function writeConvexUrlToEnvFile(
  ctx: Context,
  value: string
): Promise<ConvexUrlWriteConfig> {
  const writeConfig = await envVarWriteConfig(ctx, value);

  if (writeConfig === null) {
    return null;
  }

  const { envFile, envVar, oldValue } = writeConfig;

  if (oldValue !== undefined) {
    const modified = ctx.fs.readUtf8File(envFile).replace(oldValue, value);
    ctx.fs.writeUtf8File(envFile, modified);
  } else {
    const doesFileExist = ctx.fs.exists(envFile);
    if (doesFileExist) {
      const orig = ctx.fs.readUtf8File(envFile);
      const modified = `${orig}\n${envVar}="${value}"\n`;
      ctx.fs.writeUtf8File(envFile, modified);
    } else {
      const contents = `${envVar}="${value}"\n`;
      ctx.fs.writeUtf8File(envFile, contents);
    }
  }
  return writeConfig;
}

export async function suggestedEnvVarName(ctx: Context): Promise<{
  detectedFramework?: Framework;
  envVar: string;
}> {
  // no package.json, that's fine, just guess
  if (!ctx.fs.exists("package.json")) {
    return {
      envVar: "CONVEX_URL",
    };
  }

  const packages = await loadPackageJson(ctx);

  // Is it create-react-app?
  const isCreateReactApp = "react-scripts" in packages;
  if (isCreateReactApp) {
    return {
      detectedFramework: "create-react-app",
      envVar: "REACT_APP_CONVEX_URL",
    };
  }

  const isNextJs = "next" in packages;
  if (isNextJs) {
    return {
      detectedFramework: "Next.js",
      envVar: "NEXT_PUBLIC_CONVEX_URL",
    };
  }

  const isRemix = "@remix-run/dev" in packages;
  if (isRemix) {
    return {
      detectedFramework: "Remix",
      envVar: "CONVEX_URL",
    };
  }

  const isSvelteKit = "@sveltejs/kit" in packages;
  if (isSvelteKit) {
    return {
      detectedFramework: "SvelteKit",
      envVar: "PUBLIC_CONVEX_URL",
    };
  }

  // Vite is a dependency of a lot of things; vite appearing in dependencies is not a strong indicator.
  const isVite = "vite" in packages;

  if (isVite) {
    return {
      detectedFramework: "Vite",
      envVar: "VITE_CONVEX_URL",
    };
  }

  return {
    envVar: "CONVEX_URL",
  };
}

async function envVarWriteConfig(
  ctx: Context,
  value: string | null
): Promise<ConvexUrlWriteConfig> {
  const { detectedFramework, envVar } = await suggestedEnvVarName(ctx);

  const { envFile, existing } = suggestedDevEnvFile(ctx, detectedFramework);

  if (existing) {
    const config = dotenv.parse(ctx.fs.readUtf8File(envFile));

    const matching = Object.keys(config).filter((key) =>
      EXPECTED_NAMES.has(key)
    );
    if (matching.length > 1) {
      logWarning(
        ctx,
        chalk.yellow(
          `Found multiple CONVEX_URL environment variables in ${envFile} so cannot update automatically.`
        )
      );
      return null;
    }
    if (matching.length === 1) {
      const [envVar, oldValue] = [matching[0], config[matching[0]]];
      if (oldValue === value) {
        return null;
      }
      if (Object.values(config).filter((v) => v === oldValue).length !== 1) {
        chalk.yellow(`Can't safely modify ${envFile}, please edit manually.`);
        return null;
      }
      return { envFile, envVar, oldValue };
    }
  }

  return { envFile, envVar };
}

function suggestedDevEnvFile(
  ctx: Context,
  framework?: Framework
): {
  existing: boolean;
  envFile: string;
} {
  // If a .env.local file exists, that's unequivocally the right file
  if (ctx.fs.exists(".env.local")) {
    return {
      existing: true,
      envFile: ".env.local",
    };
  }

  // Remix is on team "don't commit the .env file," so .env is for dev.
  if (framework === "Remix") {
    return {
      existing: ctx.fs.exists(".env"),
      envFile: ".env",
    };
  }

  // The most dev-looking env file that exists, or .env.local
  return {
    existing: ctx.fs.exists(".env.local"),
    envFile: ".env.local",
  };
}

const EXPECTED_NAMES = new Set([
  "CONVEX_URL",
  "PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "VITE_CONVEX_URL",
  "REACT_APP_CONVEX_URL",
]);

export function buildEnvironment(): string | boolean {
  return process.env.VERCEL
    ? "Vercel"
    : process.env.NETLIFY
    ? "Netlify"
    : false;
}

export function gitBranchFromEnvironment(): string | null {
  if (process.env.VERCEL) {
    // https://vercel.com/docs/projects/environment-variables/system-environment-variables
    return process.env.VERCEL_GIT_COMMIT_REF ?? null;
  }
  if (process.env.NETLIFY) {
    // https://docs.netlify.com/configure-builds/environment-variables/
    return process.env.HEAD ?? null;
  }

  if (process.env.CI) {
    // https://docs.github.com/en/actions/learn-github-actions/variables
    // https://docs.gitlab.com/ee/ci/variables/predefined_variables.html
    return (
      process.env.GITHUB_HEAD_REF ?? process.env.CI_COMMIT_REF_NAME ?? null
    );
  }

  return null;
}

export function isNonProdBuildEnvironment(): boolean {
  if (process.env.VERCEL) {
    // https://vercel.com/docs/projects/environment-variables/system-environment-variables
    return process.env.VERCEL_ENV !== "production";
  }
  if (process.env.NETLIFY) {
    // https://docs.netlify.com/configure-builds/environment-variables/
    return process.env.CONTEXT !== "production";
  }
  return false;
}
