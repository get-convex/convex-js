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
  const apiDTS = `${header("Generated `api` utility.")}
  import type { ApiFromModules } from "convex/server";
  ${modulePaths
    .map(
      modulePath =>
        `import type * as ${moduleIdentifier(modulePath)} from "../${importPath(
          modulePath
        )}";`
    )
    .join("\n")}

  /**
   * A utility for referencing Convex functions in your app's API.
   * 
   * Usage:
   * \`\`\`js
   * const myFunctionReference = api.myModule.myFunction;
   * \`\`\`
   */
  export declare const api: ApiFromModules<{
    ${modulePaths
      .map(
        modulePath =>
          `"${importPath(modulePath)}": typeof ${moduleIdentifier(modulePath)},`
      )
      .join("\n")}
  }>;
  `;

  const apiJS = `${header("Generated `api` utility.")}
  import { anyApi } from "convex/server";

  /**
   * A utility for referencing Convex functions in your app's API.
   * 
   * Usage:
   * \`\`\`js
   * const myFunctionReference = api.myModule.myFunction;
   * \`\`\`
   */
  export const api = anyApi;
  `;
  return {
    DTS: apiDTS,
    JS: apiJS,
  };
}
