import { GeneratedJsWithTypes, header } from "./common.js";

export function importPath(modulePath: string) {
  // Replace backslashes with forward slashes.
  const filePath = modulePath.replace(/\\/g, "/");
  // Strip off the file extension.
  const lastDot = filePath.lastIndexOf(".");
  return filePath.slice(0, lastDot === -1 ? undefined : lastDot);
}

export function moduleIdentifier(modulePath: string) {
  // TODO: This encoding is ambiguous (`foo/bar` vs `foo_bar` vs `foo-bar`).
  // Also we should be renaming keywords like `delete`.
  return importPath(modulePath).replace(/\//g, "_").replace(/-/g, "_");
}

export function apiCodegen(modulePaths: string[]): GeneratedJsWithTypes {
  const reactDTS = `${header("Generated API.")}
  import type { ApiFromModules } from "convex/api";
  ${modulePaths
    .map(
      modulePath =>
        `import type * as ${moduleIdentifier(modulePath)} from "../${importPath(
          modulePath
        )}";`
    )
    .join("\n")}

  /**
   * A type describing your app's public Convex API.
   *
   * This \`API\` type includes information about the arguments and return
   * types of your app's query and mutation functions.
   *
   * This type should be used with type-parameterized classes like
   * \`ConvexReactClient\` to create app-specific types.
   */
  export type API = ApiFromModules<{
    ${modulePaths
      .map(
        modulePath =>
          `"${importPath(modulePath)}": typeof ${moduleIdentifier(modulePath)},`
      )
      .join("\n")}
  }>;
  `;
  return {
    DTS: reactDTS,
  };
}
