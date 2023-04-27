import { Command, Option } from "commander";
import chalk from "chalk";
import { readProjectConfig } from "./lib/config";
import {
  ensureHasConvexDependency,
  logAndHandleAxiosError,
  formatSize,
} from "./lib/utils";
import axios, { AxiosResponse } from "axios";
import { version } from "../index.js";
import { getUrlAndAdminKey } from "./lib/api";
import { oneoffContext } from "./lib/context";

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
  .action(async (tableName: string, path: string, options: any) => {
    const ctx = oneoffContext;
    let format = options.format;
    const pathParts = path.split(".");
    if (pathParts.length > 1) {
      const fileType = pathParts[pathParts.length - 1];
      const formatToFileType: Record<string, string> = {
        csv: "csv",
        jsonLines: "jsonl",
        jsonArray: "json",
      };
      const fileTypeToFormat = Object.fromEntries(
        Object.entries(formatToFileType).map(a => a.reverse())
      );
      if (format && fileType !== formatToFileType[format]) {
        console.warn(
          chalk.yellow(
            `Warning: Extension of file ${path} (${fileType}) does not match specified format: ${format} (${formatToFileType[format]}).`
          )
        );
      }
      if (format === undefined) {
        format = fileTypeToFormat[fileType];
      }
    }
    if (!format) {
      throw new Error(
        "No input file format inferred by the filename extension or specified. Specify your input file's format using the `--format` flag."
      );
    }
    const { projectConfig } = await readProjectConfig(ctx);
    const deploymentType = options.prod ? "prod" : "dev";
    let deploymentUrl, adminKey;
    if (!options.url || !options.adminKey) {
      let url;
      ({ url, adminKey } = await getUrlAndAdminKey(
        ctx,
        projectConfig.project,
        projectConfig.team,
        deploymentType
      ));
      deploymentUrl = url;
    }
    adminKey = options.adminKey ?? adminKey;
    deploymentUrl = options.url ?? deploymentUrl;
    await ensureHasConvexDependency(ctx, "import");

    if (!ctx.fs.exists(path)) {
      console.error(chalk.gray(`Error: Path ${path} does not exist.`));
      return await ctx.crash(1, "invalid filesystem data");
    }
    const data = ctx.fs.createReadStream(path);
    const fileStats = ctx.fs.stat(path);
    console.log(
      chalk.gray(`Importing ${path} (${formatSize(fileStats.size)})...`)
    );
    const urlName = encodeURIComponent(tableName);
    const urlFormat = encodeURIComponent(format);
    const client = axios.create();
    let resp: AxiosResponse;
    let mode = "requireEmpty";
    if (options.append) {
      mode = "append";
    } else if (options.replace) {
      mode = "replace";
    }
    try {
      const url = `${deploymentUrl}/api/import?tableName=${urlName}&format=${urlFormat}&mode=${mode}`;
      resp = await client.post(url, data, {
        headers: {
          Authorization: `Convex ${adminKey}`,
          "Content-Type": "text/plain",
          "Convex-Client": `npm-cli-${version}`,
        },
      });
    } catch (e) {
      return await logAndHandleAxiosError(ctx, e);
    }
    console.log(
      chalk.green(`Wrote ${resp.data.numWritten} rows to ${tableName}.`)
    );
  });
