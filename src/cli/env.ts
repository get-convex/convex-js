import { Command } from "commander";
import { logFailure, logMessage, oneoffContext } from "../bundler/context.js";
import {
  deploymentSelectionFromOptions,
  DeploymentSelectionOptions,
  fetchDeploymentCredentialsWithinCurrentProject,
} from "./lib/api.js";
import {
  DeploymentCommand,
  deploymentClient,
  ensureHasConvexDependency,
} from "./lib/utils.js";
import { version } from "./version.js";
import chalk from "chalk";
import { runQuery } from "./lib/run.js";

const envSet = new Command("set")
  .arguments("<name> <value>")
  .configureHelp({ showGlobalOptions: true })
  .action(async (name, value, _options, cmd) => {
    const options = cmd.optsWithGlobals();
    await ensureHasConvexDependency(oneoffContext, "env set");
    await callUpdateEnvironmentVariables(options, [{ name, value }]);
    logMessage(oneoffContext, chalk.green(`Successfully set ${name}=${value}`));
  });

const envGet = new Command("get")
  .arguments("<name>")
  .configureHelp({ showGlobalOptions: true })
  .action(async (envVarName, _options, cmd) => {
    const ctx = oneoffContext;
    await ensureHasConvexDependency(ctx, "env get");
    const options = cmd.optsWithGlobals();
    const deploymentSelection = deploymentSelectionFromOptions(options);
    const { adminKey, url } =
      await fetchDeploymentCredentialsWithinCurrentProject(
        oneoffContext,
        deploymentSelection
      );

    const envVar = await runQuery(
      oneoffContext,
      url,
      adminKey,
      "_system/cli/queryEnvironmentVariables:get",
      { name: envVarName }
    );
    if (envVar === null) {
      logFailure(
        oneoffContext,
        `Environment variable "${envVarName}" not found.`
      );
      return;
    }
    type EnvVar = {
      name: string;
      value: string;
    };
    const { name, value } = envVar as EnvVar;
    logMessage(oneoffContext, `${name}=${value}`);
  });

const envRemove = new Command("remove")
  .alias("rm")
  .arguments("<name>")
  .configureHelp({ showGlobalOptions: true })
  .action(async (name, _options, cmd) => {
    const options = cmd.optsWithGlobals();
    await ensureHasConvexDependency(oneoffContext, "env remove");
    await callUpdateEnvironmentVariables(options, [{ name }]);
    logMessage(oneoffContext, chalk.green(`Successfully unset ${name}`));
  });

const envList = new Command("list")
  .configureHelp({ showGlobalOptions: true })
  .action(async (_options, cmd) => {
    const ctx = oneoffContext;
    await ensureHasConvexDependency(ctx, "env list");
    const options = cmd.optsWithGlobals();
    const deploymentSelection = deploymentSelectionFromOptions(options);
    const { adminKey, url } =
      await fetchDeploymentCredentialsWithinCurrentProject(
        oneoffContext,
        deploymentSelection
      );

    type EnvVar = {
      name: string;
      value: string;
    };
    const envs = (await runQuery(
      oneoffContext,
      url,
      adminKey,
      "_system/cli/queryEnvironmentVariables",
      {}
    )) as EnvVar[];
    for (const { name, value } of envs) {
      logMessage(oneoffContext, `${name}=${value}`);
    }
  });

type EnvVarChange = {
  name: string;
  value?: string;
};

async function callUpdateEnvironmentVariables(
  options: DeploymentSelectionOptions,
  changes: EnvVarChange[]
) {
  const deploymentSelection = deploymentSelectionFromOptions(options);
  const { adminKey, url } =
    await fetchDeploymentCredentialsWithinCurrentProject(
      oneoffContext,
      deploymentSelection
    );
  const client = deploymentClient(url);
  const headers = {
    Authorization: `Convex ${adminKey}`,
    "Convex-Client": `npm-cli-${version}`,
  };
  await client.post(
    "/api/update_environment_variables",
    { changes },
    {
      headers,
    }
  );
}

export const env = new DeploymentCommand("env")
  .summary("Set and view environment variables")
  .description(
    "Set and view environment variables on your deployment\n\n" +
      "  Set a variable: `npx convex env set name value`\n" +
      "  Unset a variable: `npx convex env remove name`\n" +
      "  List all variables: `npx convex env list`\n" +
      "  Print a variable's value: `npx convex env get name`\n\n" +
      "By default, this sets and views variables on your dev deployment."
  )
  .addDeploymentSelectionOptions("Set and view environment variables on")
  .addCommand(envSet)
  .addCommand(envGet)
  .addCommand(envRemove)
  .addCommand(envList);
