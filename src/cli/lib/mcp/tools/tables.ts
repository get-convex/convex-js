import { z } from "zod";
import { ConvexTool } from "./index.js";
import { loadSelectedDeploymentCredentials } from "../../api.js";
import { runSystemQuery } from "../../run.js";
import { deploymentFetch } from "../../utils/utils.js";
import { getDeploymentSelection } from "../../deploymentSelection.js";
import { resolveComponent, formatComponentError } from "./componentResolver.js";

const inputSchema = z.object({
  deploymentSelector: z
    .string()
    .describe(
      "Deployment selector (from the status tool) to read tables from.",
    ),
  componentPath: z
    .string()
    .optional()
    .describe(
      "Component path (e.g., 'widget') or component ID. Use the 'components' tool to list available components. Omit for root.",
    ),
});

const outputSchema = z.object({
  tables: z.record(
    z.string(),
    z.object({
      schema: z.any().optional(),
      inferredSchema: z.any().optional(),
    }),
  ),
});

export const TablesTool: ConvexTool<typeof inputSchema, typeof outputSchema> = {
  name: "tables",
  description:
    "List all tables in a Convex deployment (or component) and their inferred and declared schema. Use componentPath to view a component's tables.",
  inputSchema,
  outputSchema,
  handler: async (ctx, args) => {
    const { projectDir, deployment } = await ctx.decodeDeploymentSelector(
      args.deploymentSelector,
    );
    process.chdir(projectDir);
    const deploymentSelection = await getDeploymentSelection(ctx, ctx.options);
    const credentials = await loadSelectedDeploymentCredentials(
      ctx,
      deploymentSelection,
      deployment,
    );

    // Resolve componentPath to get both path and ID
    const { component, allComponents } = await resolveComponent(
      ctx,
      credentials,
      args.componentPath,
    );

    // If componentPath was provided but not found, return helpful error
    if (args.componentPath && !component) {
      return await ctx.crash({
        exitCode: 1,
        errorType: "fatal",
        printedMessage: formatComponentError(args.componentPath, allComponents),
      });
    }

    // Use path for WebSocket calls (backend resolves path to context)
    const schemaResponse: any = await runSystemQuery(ctx, {
      deploymentUrl: credentials.url,
      adminKey: credentials.adminKey,
      functionName: "_system/frontend/getSchemas",
      componentPath: component?.path,
      args: {},
    });
    const schema: Record<string, z.infer<typeof activeSchemaEntry>> = {};
    if (schemaResponse.active) {
      const parsed = activeSchema.parse(JSON.parse(schemaResponse.active));
      for (const table of parsed.tables) {
        schema[table.tableName] = table;
      }
    }

    // Use ID for HTTP calls (shapes2 expects document ID, not path)
    const fetch = deploymentFetch(ctx, {
      deploymentUrl: credentials.url,
      adminKey: credentials.adminKey,
    });
    const componentQuery = component ? `?component=${component.id}` : "";
    const response = await fetch(`/api/shapes2${componentQuery}`, {});
    const shapesResult: Record<string, any> = await response.json();

    const allTablesSet = new Set([
      ...Object.keys(shapesResult),
      ...Object.keys(schema),
    ]);
    const allTables = Array.from(allTablesSet);
    allTables.sort();

    const result: z.infer<typeof outputSchema>["tables"] = {};
    for (const table of allTables) {
      result[table] = {
        schema: schema[table],
        inferredSchema: shapesResult[table],
      };
    }
    return { tables: result };
  },
};

const activeSchemaEntry = z.object({
  tableName: z.string(),
  indexes: z.array(z.any()),
  searchIndexes: z.array(z.any()),
  vectorIndexes: z.array(z.any()),
  documentType: z.any(),
});

const activeSchema = z.object({ tables: z.array(activeSchemaEntry) });
