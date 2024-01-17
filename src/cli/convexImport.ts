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
  .description(
    "Import data from a file\n\n" +
      "  From a snapshot: `npx convex import snapshot.zip`\n" +
      "  For a single table: `npx convex --table tableName file.json`\n"
  )
  .addOption(
    new Option(
      "--table <table>",
      "Destination table name. Required if format is csv, jsonLines, or jsonArray. Not supported if format is zip."
    )
  )
  .addOption(
    new Option(
      "--format <format>",
      "Input file format. This flag is only required if the filename is missing an extension.\n" +
        "CSV files must have a header, and each row's entries are interpreted either as a (floating point) number or a string.\n" +
        "JSON files must be an array of JSON objects.\n" +
        "JSONLines files must have a JSON object per line.\n" +
        "ZIP files must have one directory per table, containing <table>/documents.jsonl. Snapshot exports from the Convex dashboard have this format."
    ).choices(["csv", "jsonLines", "jsonArray", "zip"])
  )
  .option(
    "--prod",
    "Import data into this project's production deployment. Defaults to your dev deployment without this flag."
  )
  .addOption(
    new Option(
      "--replace",
      "Replace all existing data in any of the imported tables"
    ).conflicts("--append")
  )
  .addOption(
    new Option(
      "--append",
      "Append imported data to any existing tables"
    ).conflicts("--replace")
  )
  .addOption(new Option("--url <url>").hideHelp())
  .addOption(new Option("--admin-key <adminKey>").hideHelp())
  .argument("<path>", "Path to the input file")
  .showHelpAfterError()
  .action(async (filePath: string, options: any, command: any) => {
    const ctx = oneoffContext;

    if (command.args.length > 1) {
      logFailure(
        ctx,
        `Error: Too many positional arguments. If you're specifying a table name, use the \`--table\` option.`
      );
      return await ctx.crash(1, "fatal");
    }

    const { adminKey, url: deploymentUrl } =
      await fetchDeploymentCredentialsProvisionProd(ctx, options);

    if (!ctx.fs.exists(filePath)) {
      logFailure(ctx, `Error: Path ${chalk.bold(filePath)} does not exist.`);
      return await ctx.crash(1, "invalid filesystem data");
    }

    const format = await determineFormat(ctx, filePath, options.format ?? null);
    const tableName = options.table ?? null;
    if (tableName === null) {
      if (format !== "zip") {
        logFailure(
          ctx,
          `Error: The \`--table\` option is required for format ${format}`
        );
        return await ctx.crash(1, "fatal");
      }
    } else {
      if (format === "zip") {
        logFailure(
          ctx,
          `Error: The \`--table\` option is not allowed for format ${format}`
        );
        return await ctx.crash(1, "fatal");
      }
    }

    await ensureHasConvexDependency(ctx, "import");

    const data = ctx.fs.createReadStream(filePath);
    const fileStats = ctx.fs.stat(filePath);

    showSpinner(ctx, `Importing ${filePath} (${formatSize(fileStats.size)})`);

    const urlName =
      tableName === null ? "" : `&tableName=${encodeURIComponent(tableName)}`;
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
    const tableNotice = tableName ? ` to table "${chalk.bold(tableName)}"` : "";
    try {
      const url = `/api/import?format=${urlFormat}&mode=${mode}${urlName}`;
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
        `Importing data from "${chalk.bold(
          filePath
        )}"${tableNotice}${deploymentNotice} failed`
      );
      return await logAndHandleAxiosError(ctx, e);
    }
    logFinishedStep(
      ctx,
      `Added ${resp.data.numWritten} documents${tableNotice}${deploymentNotice}.`
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
      zip: ".zip",
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
    format ??= extensionToFormat[fileExtension] ?? null;
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
