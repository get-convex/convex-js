/**
 * Help the developer store the CONVEX_URL environment variable.
 */
import chalk from "chalk";
import * as dotenv from "dotenv";

import inquirer from "inquirer";
import { Context, logFinishedStep } from "./context";
import { loadPackageJson } from "./utils";

const FRAMEWORKS = ["create-react-app", "Next.js", "Vite", "Remix"] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export async function offerToWriteToEnv(
  ctx: Context,
  type: "dev" | "prod",
  value: string,
  saveUrl: "yes" | "no" | "ask" = "ask" as const
) {
  const write = await askAboutWritingToEnv(ctx, type, value, saveUrl);
  await writeToEnv(ctx, write, value);
  if (write) {
    const { envFile, envVar } = write;
    logFinishedStep(
      ctx,
      `Saved ${type} deployment URL as ${envVar} to ${envFile}`
    );
  }
}

type WriteConfig = {
  envFile: string;
  type: string;
  envVar: string;
  oldValue?: string;
} | null;

export async function askAboutWritingToEnv(
  ctx: Context,
  type: "dev" | "prod",
  value: string | null,
  saveUrl: "yes" | "no" | "ask" = "ask" as const
): Promise<WriteConfig> {
  if (saveUrl === "no") {
    return null;
  }

  const { detectedFramework, envVar } = await suggestedEnvVarName(ctx);

  if (detectedFramework === "Remix" && type === "prod") {
    return null;
  }

  const { envFile, existing } =
    type === "dev"
      ? suggestedDevEnvFile(ctx, detectedFramework)
      : suggestedProdEnvFile(ctx);

  if (existing) {
    const config = dotenv.parse(ctx.fs.readUtf8File(envFile));

    const matching = Object.keys(config).filter(key => EXPECTED_NAMES.has(key));
    if (matching.length > 1) {
      console.error(
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
      if (Object.values(config).filter(v => v === oldValue).length !== 1) {
        chalk.yellow(`Can't safely modify ${envFile}, please edit manually.`);
        return null;
      }
      if (
        saveUrl === "yes" ||
        (await promptAboutSaving(type, envVar, envFile))
      ) {
        return { envFile, type, envVar, oldValue };
      }
      return null;
    }
  }

  if (saveUrl === "yes" || (await promptAboutSaving(type, envVar, envFile))) {
    return { envFile, type, envVar };
  }

  return null;
}

async function promptAboutSaving(
  type: "dev" | "prod",
  envVar: string,
  envFile: string
) {
  return (
    await inquirer.prompt([
      {
        type: "confirm",
        name: "updateEnvFile",
        message: `Save ${type} deployment URL as ${envVar} to ${envFile}?`,
        default: true,
      },
    ])
  ).updateEnvFile;
}

export async function writeToEnv(
  ctx: Context,
  writeConfig: WriteConfig,
  value: string
) {
  if (!writeConfig) {
    return;
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
}

export function logProvisioning(
  ctx: Context,
  writeConfig: WriteConfig,
  type: "dev" | "prod",
  url: string
) {
  if (writeConfig) {
    const { envVar, envFile } = writeConfig;
    logFinishedStep(
      ctx,
      `Provisioned ${type} deployment and saved its URL as ${envVar} to ${envFile}`
    );
  } else {
    logFinishedStep(
      ctx,
      `Provisioned ${type} deployment at ${chalk.bold(url)}`
    );
  }
}

export function logConfiguration(
  ctx: Context,
  writeConfig: WriteConfig,
  type: "dev" | "prod",
  url: string
) {
  if (writeConfig) {
    const { envVar, envFile } = writeConfig;
    logFinishedStep(
      ctx,
      `Configured ${type} deployment and saved its URL as ${envVar} to ${envFile}`
    );
  } else {
    logFinishedStep(ctx, `Configured ${type} deployment at ${chalk.bold(url)}`);
  }
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

function suggestedProdEnvFile(ctx: Context): {
  existing: boolean;
  envFile: string;
} {
  // The most prod-looking env file that exists, or .env
  if (ctx.fs.exists(".env.production")) {
    return {
      existing: true,
      envFile: ".env.production",
    };
  }
  if (ctx.fs.exists(".env")) {
    return {
      existing: true,
      envFile: ".env",
    };
  }
  return {
    existing: false,
    envFile: ".env",
  };
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
