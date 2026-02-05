import { z } from "zod";
import { ConvexTool } from "./index.js";
import { loadSelectedDeploymentCredentials } from "../../api.js";
import { getDeploymentSelection } from "../../deploymentSelection.js";
import { resolveComponent } from "./componentResolver.js";

const inputSchema = z.object({
  deploymentSelector: z
    .string()
    .describe(
      "Deployment selector (from the status tool) to list components from.",
    ),
});

const outputSchema = z.object({
  components: z.array(
    z.object({
      id: z.string().describe("Component ID (can be used as componentPath)"),
      name: z
        .string()
        .nullable()
        .describe("Component name (null for root)"),
      path: z
        .string()
        .describe(
          "Component path (e.g., 'widget') - use this with other tools",
        ),
      state: z
        .string()
        .describe("Component state ('active' or 'unmounted')"),
    }),
  ),
});

const description = `
List all components in a Convex deployment.

Use the returned 'path' values as the componentPath parameter in other tools
(tables, data, functionSpec, run). You can also use the 'id' if needed.

The root component has an empty path ("").
`.trim();

export const ComponentsTool: ConvexTool<typeof inputSchema, typeof outputSchema> =
  {
    name: "components",
    description,
    inputSchema,
    outputSchema,
    handler: async (ctx, args) => {
      const { projectDir, deployment } = await ctx.decodeDeploymentSelector(
        args.deploymentSelector,
      );
      process.chdir(projectDir);
      const deploymentSelection = await getDeploymentSelection(
        ctx,
        ctx.options,
      );
      const credentials = await loadSelectedDeploymentCredentials(
        ctx,
        deploymentSelection,
        deployment,
      );

      const { allComponents } = await resolveComponent(
        ctx,
        credentials,
        undefined,
      );
      return { components: allComponents };
    },
  };
