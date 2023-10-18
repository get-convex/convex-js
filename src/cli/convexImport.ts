import { Command, Option } from "commander";
import chalk from "chalk";
import {
  ensureHasConvexDependency,
  logAndHandleAxiosError,
  formatSize,
  deploymentClient,
} from "./lib/utils.js";
import { AxiosResponse } from "axios";
import { version } from "./version.js";
import {
  logFailure,
  oneoffContext,
  Context,
  showSpinner,
  logFinishedStep,
  logWarning,
} from "../bundler/context.js";
import { fetchDeploymentCredentialsProvisionProd } from "./lib/api.js";
import path from "path";

export const convexImport = new Command("import")
  .description("Import data from a file into a table")
  .addOption(
    new Option(
      "--format <format>",
      "Input file format. This flag is only required if the filename is missing an extension.\
      CSV files must have a header, and each rows' entries are interpreted either as a (floating point) number or a string.\
      JSONLines files must have a JSON object per line. JSON files must be an array of JSON objects."
    ).choices(["csv", "jsonLines", "jsonArray"])
  )
  .option(
    "--prod",
    "Import data into this project's production deployment. Defaults to your dev deployment without this flag."
  )
  .addOption(
    new Option("--replace", "Replace any existing data in the table").conflicts(
      "--append"
    )
  )
  .addOption(
    new Option(
      "--append",
      "Append to any existing data in the table"
    ).conflicts("--replace")
  )
  .addOption(new Option("--url <url>").hideHelp())
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .argument("<tableName>", "Destination table name")
  .argument("<path>", "Path to the input file")
  .showHelpAfterError()
  .action(async (tableName: string, filePath: string, options: any) => {
    const ctx = oneoffContext;
    const { adminKey, url: deploymentUrl } =
      await fetchDeploymentCredentialsProvisionProd(ctx, options);

    if (!ctx.fs.exists(filePath)) {
      logFailure(ctx, `Error: Path ${chalk.bold(filePath)} does not exist.`);
      return await ctx.crash(1, "invalid filesystem data");
    }

    const format = await determineFormat(ctx, filePath, options.format ?? null);

    await ensureHasConvexDependency(ctx, "import");

    const data = ctx.fs.createReadStream(filePath);
    const fileStats = ctx.fs.stat(filePath);

    showSpinner(ctx, `Importing ${filePath} (${formatSize(fileStats.size)})`);

    const urlName = encodeURIComponent(tableName);
    const urlFormat = encodeURIComponent(format);
    const client = deploymentClient(deploymentUrl);
    let resp: AxiosResponse;
    let mode = "requireEmpty";
    if (options.append) {
      mode = "append";
    } else if (options.replace) {
      mode = "replace";
    }
    const deploymentNotice = options.prod
      ? ` in your ${chalk.bold("prod")} deployment`
      : "";
    try {
      const url = `/api/import?tableName=${urlName}&format=${urlFormat}&mode=${mode}`;
      resp = await client.post(url, data, {
        headers: {
          Authorization: `Convex ${adminKey}`,
          "Content-Type": "text/plain",
          "Convex-Client": `npm-cli-${version}`,
        },
      });
    } catch (e) {
      logFailure(
        ctx,
        `Importing data from ${chalk.bold(filePath)} to table ${chalk.bold(
          tableName
        )}${deploymentNotice} failed`
      );
      return await logAndHandleAxiosError(ctx, e);
    }
    logFinishedStep(
      ctx,
      `Added ${resp.data.numWritten} documents to table ${chalk.bold(
        tableName
      )}${deploymentNotice}.`
    );
  });

async function determineFormat(
  ctx: Context,
  filePath: string,
  format: string | null
) {
  const fileExtension = path.extname(filePath);
  if (fileExtension !== "") {
    const formatToExtension: Record<string, string> = {
      csv: ".csv",
      jsonLines: ".jsonl",
      jsonArray: ".json",
    };
    const extensionToFormat = Object.fromEntries(
      Object.entries(formatToExtension).map((a) => a.reverse())
    );
    if (format !== null && fileExtension !== formatToExtension[format]) {
      logWarning(
        ctx,
        chalk.yellow(
          `Warning: Extension of file ${filePath} (${fileExtension}) does not match specified format: ${format} (${formatToExtension[format]}).`
        )
      );
    }
    format ??= extensionToFormat[fileExtension];
  }
  if (format === null) {
    logFailure(
      ctx,
      "No input file format inferred by the filename extension or specified. Specify your input file's format using the `--format` flag."
    );
    return await ctx.crash(1, "fatal");
  }
  return format;
}
