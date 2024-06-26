import {
  Infer,
  ObjectType,
  PropertyValidators,
  convexToJson,
} from "../../values/index.js";
import { AnyFunctionReference } from "../api.js";
import { EmptyObject } from "../registration.js";
import {
  AppDefinitionAnalysis,
  ComponentDefinitionAnalysis,
  ComponentDefinitionType,
} from "./definition.js";

/**
 * An object of this type should be the default export of a
 * component.config.ts file in a component definition directory.
 *
 * @internal
 */ // eslint-disable-next-line @typescript-eslint/ban-types
export type ComponentDefinition<Args extends PropertyValidators = EmptyObject> =
  {
    /**
     * Install a component with the given definition in this component definition.
     *
     * Takes a component definition, an optional name, and the args it requires.
     *
     * For editor tooling this method expects a {@link ComponentDefinition}
     * but at runtime the object that is imported will be a {@link ImportedComponentDefinition}
     */
    install<Definition extends ComponentDefinition<any>>(
      definition: Definition,
      options: {
        name?: string;
        // TODO we have to do the "arguments are optional if empty, otherwise required"
        args?: ObjectType<ExtractArgs<Definition>>;
      },
    ): InstalledComponent<Definition>;

    // TODO this will be needed once components are responsible for building interfaces for themselves
    /**
     * @internal
     */
    __args: Args;
  };

/**
 * An object of this type should be the default export of a
 * app.config.ts file in a component definition directory.
 *
 * @internal
 */
export type AppDefinition = {
  /**
   * Install a component with the given definition in this component definition.
   *
   * Takes a component definition, an optional name, and the args it requires.
   *
   * For editor tooling this method expects a {@link ComponentDefinition}
   * but at runtime the object that is imported will be a {@link ImportedComponentDefinition}
   */
  install<Definition extends ComponentDefinition<any>>(
    definition: Definition,
    options: {
      name?: string;
      args?: ObjectType<ExtractArgs<Definition>>;
    },
  ): InstalledComponent<Definition>;
};

type CommonDefinitionData = {
  _isRoot: boolean;
  _childComponents: [
    string,
    ImportedComponentDefinition,
    Record<string, any>,
  ][];
};
type ComponentDefinitionData = CommonDefinitionData & {
  _args: PropertyValidators;
  _name: string;
};
type AppDefinitionData = CommonDefinitionData;

type ExtractArgs<T> = T extends ComponentDefinition<infer P> ? P : never;

/**
 * Used to refer to an already-installed component.
 */
type InstalledComponent<Definition extends ComponentDefinition<any>> =
  // eslint-disable-next-line @typescript-eslint/ban-types
  {
    /**
     * @internal
     */
    _definition: Definition;
  };

function install<Definition extends ComponentDefinition<any>>(
  this: CommonDefinitionData,
  definition: Definition,
  options: {
    name?: string;
    args?: Infer<ExtractArgs<Definition>>;
  } = {},
): InstalledComponent<Definition> {
  // At runtime an imported component will have this shape.
  const importedComponentDefinition =
    definition as unknown as ImportedComponentDefinition;
  if (typeof importedComponentDefinition.componentDefinitionPath !== "string") {
    throw new Error(
      "Component definition does not have the required componentDefinitionPath property. This code only works in Convex runtime.",
    );
  }
  this._childComponents.push([
    options.name ||
      importedComponentDefinition.componentDefinitionPath.split("/").pop()!,
    importedComponentDefinition,
    options.args || {},
  ]);

  return {} as InstalledComponent<Definition>;
}

// At runtime when you import a ComponentDefinition, this is all it is
/**
 * @internal
 */
export type ImportedComponentDefinition = {
  componentDefinitionPath: string;
};

function exportAppForAnalysis(
  this: ComponentDefinition<any> & AppDefinitionData,
): AppDefinitionAnalysis {
  const definitionType = { type: "app" as const };
  const childComponents = serializeChildComponents(this._childComponents);

  return {
    definitionType,
    childComponents: childComponents as any,
    exports: { type: "branch", branch: [] },
  };
}

function serializeChildComponents(
  childComponents: [string, ImportedComponentDefinition, Record<string, any>][],
): {
  name: string;
  path: string;
  args: [string, { type: "value"; value: string }][];
}[] {
  return childComponents.map(([name, definition, p]) => {
    const args: [string, { type: "value"; value: string }][] = [];
    for (const [name, value] of Object.entries(p)) {
      args.push([
        name,
        { type: "value", value: JSON.stringify(convexToJson(value)) },
      ]);
    }
    // we know that components carry this extra information
    const path = definition.componentDefinitionPath;
    if (!path)
      throw new Error(
        "no .componentPath for component definition " +
          JSON.stringify(definition, null, 2),
      );

    return {
      name: name!,
      path: path!,
      args,
    };
  });
}

function exportComponentForAnalysis(
  this: ComponentDefinition<any> & ComponentDefinitionData,
): ComponentDefinitionAnalysis {
  const args: [string, { type: "value"; value: string }][] = Object.entries(
    this._args,
  ).map(([name, validator]) => [
    name,
    {
      type: "value",
      value: JSON.stringify(validator.json),
    },
  ]);
  const definitionType: ComponentDefinitionType = {
    type: "childComponent" as const,
    name: this._name,
    args,
  };
  const childComponents = serializeChildComponents(this._childComponents);

  return {
    name: this._name,
    definitionType,
    childComponents: childComponents as any,
    exports: { type: "branch", branch: [] },
  };
}

// This is what is actually contained in a ComponentDefinition.
type RuntimeComponentDefinition = Exclude<ComponentDefinition<any>, "__args"> &
  ComponentDefinitionData & {
    export: () => ComponentDefinitionAnalysis;
  };
type RuntimeAppDefinition = AppDefinition &
  AppDefinitionData & {
    export: () => AppDefinitionAnalysis;
  };

/**
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function defineComponent<Args extends PropertyValidators = {}>(
  name: string,
  options: { args?: Args } = {},
): ComponentDefinition<Args> {
  const ret: RuntimeComponentDefinition = {
    _isRoot: false,
    _name: name,
    _args: options.args || {},
    _childComponents: [],
    export: exportComponentForAnalysis,
    install,
    // pretend to conform to ComponentDefinition, which temporarily expects __args
    ...({} as { __args: any }),
  };
  return ret as ComponentDefinition<Args>;
}

/**
 * @internal
 */
export function defineApp(): AppDefinition {
  const ret: RuntimeAppDefinition = {
    _isRoot: true,
    _childComponents: [],
    export: exportAppForAnalysis,
    install: install,
  };
  return ret as AppDefinition;
}

type AnyInterfaceType = {
  [key: string]: AnyInterfaceType;
} & AnyFunctionReference;
export type AnyComponentReference = Record<string, AnyInterfaceType>;

type AnyChildComponents = Record<string, AnyComponentReference>;

const toReferencePath = Symbol.for("toReferencePath");

export function extractReferencePath(reference: any): string | null {
  return reference[toReferencePath] ?? null;
}

function createChildComponents(
  root: string,
  pathParts: string[],
): AnyChildComponents {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (typeof prop === "string") {
        const newParts = [...pathParts, prop];
        return createChildComponents(root, newParts);
      } else if (prop === toReferencePath) {
        if (pathParts.length < 1) {
          const found = [root, ...pathParts].join(".");
          throw new Error(
            `API path is expected to be of the form \`${root}.childComponent.functionName\`. Found: \`${found}\``,
          );
        }
        return `_reference/childComponent/` + pathParts.join("/");
      } else {
        return undefined;
      }
    },
  };
  return new Proxy({}, handler);
}

/**
 * @internal
 */
export const appGeneric = () => createChildComponents("app", []);

/**
 * @internal
 */
export type AnyApp = AnyChildComponents;

/**
 * @internal
 */
export const componentGeneric = () => createChildComponents("component", []);

/**
 * @internal
 */
export type AnyComponent = AnyChildComponents;
