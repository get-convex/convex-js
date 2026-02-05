import { Context } from "../../../../bundler/context.js";
import { runSystemQuery } from "../../run.js";

export type ComponentInfo = {
  id: string;
  name: string | null;
  path: string;
  state: string;
};

/**
 * Resolves a component path or ID to a full ComponentInfo object.
 * Accepts either:
 * - A component path (e.g., "widget", "parent/child")
 * - A component ID (e.g., "kh72fgh3j4...")
 *
 * Returns the matched component and the full list of available components.
 */
export async function resolveComponent(
  ctx: Context,
  credentials: { url: string; adminKey: string },
  componentPathOrId: string | undefined,
): Promise<{ component: ComponentInfo | null; allComponents: ComponentInfo[] }> {
  // Fetch all components from the deployment
  const allComponents = (await runSystemQuery(ctx, {
    deploymentUrl: credentials.url,
    adminKey: credentials.adminKey,
    functionName: "_system/frontend/components:list",
    componentPath: undefined,
    args: {},
  })) as ComponentInfo[];

  if (!componentPathOrId) {
    return { component: null, allComponents };
  }

  // Try to match by path first (more common), then by ID
  const component =
    allComponents.find((c) => c.path === componentPathOrId) ||
    allComponents.find((c) => c.id === componentPathOrId);

  return { component: component || null, allComponents };
}

/**
 * Formats a helpful error message when a component is not found.
 */
export function formatComponentError(
  componentPathOrId: string,
  allComponents: ComponentInfo[],
): string {
  const available = allComponents.map((c) => c.path || "(root)").join(", ");
  return `Component '${componentPathOrId}' not found. Available components: ${available}`;
}
