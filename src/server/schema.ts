/**
 * Utilities for defining the schema of your Convex project.
 *
 * ## Usage
 *
 * Schemas should be placed in a `schema.ts` file in your `convex/` directory.
 *
 * Schema definitions should be built using {@link defineSchema},
 * {@link defineTable}, and {@link values.v}. Make sure to export the schema as the
 * default export.
 *
 * ```ts
 * import { defineSchema, defineTable } from "convex/server";
 * import { v } from "convex/values";
 *
 *  export default defineSchema({
 *    messages: defineTable({
 *      body: v.string(),
 *      user: v.id("users"),
 *    }),
 *    users: defineTable({
 *      name: v.string(),
 *    }),
 *  });
 * ```
 *
 * To learn more about schemas, see [Defining a Schema](https://docs.convex.dev/using/schemas).
 * @module
 */
import {
  AnyDataModel,
  GenericDataModel,
  GenericDocument,
  GenericTableIndexes,
  GenericTableSearchIndexes,
  GenericTableVectorIndexes,
  TableNamesInDataModel,
} from "../server/data_model.js";
import {
  IdField,
  IndexTiebreakerField,
  SystemFields,
  SystemIndexes,
} from "../server/system_fields.js";
import { Expand } from "../type_utils.js";
import { ObjectValidator, v, Validator } from "../values/validator.js";

/**
 * Extract all of the index field paths within a {@link Validator}.
 *
 * This is used within {@link defineTable}.
 * @public
 */
type ExtractFieldPaths<T extends Validator<any, any, any>> =
  // Add in the system fields available in index definitions.
  // This should be everything except for `_id` because thats added to indexes
  // automatically.
  T["fieldPaths"] | keyof SystemFields;

/**
 * Extract the {@link GenericDocument} within a {@link Validator} and
 * add on the system fields.
 *
 * This is used within {@link defineTable}.
 * @public
 */
type ExtractDocument<T extends Validator<any, any, any>> =
  // Add the system fields to `Value` (except `_id` because it depends on
  //the table name) and trick TypeScript into expanding them.
  Expand<SystemFields & T["type"]>;

/**
 * The configuration for a full text search index.
 *
 * @public
 */
export interface SearchIndexConfig<
  SearchField extends string,
  FilterFields extends string
> {
  /**
   * The field to index for full text search.
   *
   * This must be a field of type `string`.
   */
  searchField: SearchField;

  /**
   * Additional fields to index for fast filtering when running search queries.
   */
  filterFields?: FilterFields[];
}

/**
 * The configuration for a vector index.
 *
 * @public
 */
export interface VectorIndexConfig<
  VectorField extends string,
  FilterFields extends string
> {
  /**
   * The field to index for vector search.
   *
   * This must be a field of type `v.array(v.float64())` (or a union)
   */
  vectorField: VectorField;
  /**
   * The length of the vectors indexed. This must be between 2 and 2048 inclusive.
   */
  dimensions: number;
  /**
   * Additional fields to index for fast filtering when running vector searches.
   */
  filterFields?: FilterFields[];
}

/**
 * @internal
 */
export type VectorIndex = {
  indexDescriptor: string;
  vectorField: string;
  dimensions: number;
  filterFields: string[];
};

/**
 * @internal
 */
export type Index = {
  indexDescriptor: string;
  fields: string[];
};

/**
 * @internal
 */
export type SearchIndex = {
  indexDescriptor: string;
  searchField: string;
  filterFields: string[];
};
/**
 * The definition of a table within a schema.
 *
 * This should be produced by using {@link defineTable}.
 * @public
 */
export class TableDefinition<
  Document extends GenericDocument = GenericDocument,
  FieldPaths extends string = string,
  // eslint-disable-next-line @typescript-eslint/ban-types
  Indexes extends GenericTableIndexes = {},
  // eslint-disable-next-line @typescript-eslint/ban-types
  SearchIndexes extends GenericTableSearchIndexes = {},
  // eslint-disable-next-line @typescript-eslint/ban-types
  VectorIndexes extends GenericTableVectorIndexes = {}
> {
  private indexes: Index[];
  private searchIndexes: SearchIndex[];
  private vectorIndexes: VectorIndex[];
  // The type of documents stored in this table.
  private documentType: Validator<any, any, any>;

  /**
   * @internal
   */
  constructor(documentType: Validator<any, any, any>) {
    this.indexes = [];
    this.searchIndexes = [];
    this.vectorIndexes = [];
    this.documentType = documentType;
  }

  /**
   * Define an index on this table.
   *
   * To learn about indexes, see [Defining Indexes](https://docs.convex.dev/using/indexes).
   *
   * @param name - The name of the index.
   * @param fields - The fields to index, in order. Must specify at least one
   * field.
   * @returns A {@link TableDefinition} with this index included.
   */
  index<
    IndexName extends string,
    FirstFieldPath extends FieldPaths,
    RestFieldPaths extends FieldPaths[]
  >(
    name: IndexName,
    fields: [FirstFieldPath, ...RestFieldPaths]
  ): TableDefinition<
    Document,
    FieldPaths,
    // Update `Indexes` to include the new index and use `Expand` to make the
    // types look pretty in editors.
    Expand<
      Indexes &
        Record<
          IndexName,
          [FirstFieldPath, ...RestFieldPaths, IndexTiebreakerField]
        >
    >,
    SearchIndexes,
    VectorIndexes
  > {
    this.indexes.push({ indexDescriptor: name, fields });
    return this;
  }

  /**
   * Define a search index on this table.
   *
   * To learn about search indexes, see [Search](https://docs.convex.dev/text-search).
   *
   * @param name - The name of the index.
   * @param indexConfig - The search index configuration object.
   * @returns A {@link TableDefinition} with this search index included.
   */
  searchIndex<
    IndexName extends string,
    SearchField extends FieldPaths,
    FilterFields extends FieldPaths = never
  >(
    name: IndexName,
    indexConfig: Expand<SearchIndexConfig<SearchField, FilterFields>>
  ): TableDefinition<
    Document,
    FieldPaths,
    Indexes,
    // Update `SearchIndexes` to include the new index and use `Expand` to make
    // the types look pretty in editors.
    Expand<
      SearchIndexes &
        Record<
          IndexName,
          {
            searchField: SearchField;
            filterFields: FilterFields;
          }
        >
    >,
    VectorIndexes
  > {
    this.searchIndexes.push({
      indexDescriptor: name,
      searchField: indexConfig.searchField,
      filterFields: indexConfig.filterFields || [],
    });
    return this;
  }

  /**
   * Define a vector index on this table.
   *
   * To learn about vector indexes, see [Vector Search](https://docs.convex.dev/vector-search).
   *
   * @param name - The name of the index.
   * @param indexConfig - The vector index configuration object.
   * @returns A {@link TableDefinition} with this vector index included.
   */
  vectorIndex<
    IndexName extends string,
    VectorField extends FieldPaths,
    FilterFields extends FieldPaths = never
  >(
    name: IndexName,
    indexConfig: Expand<VectorIndexConfig<VectorField, FilterFields>>
  ): TableDefinition<
    Document,
    FieldPaths,
    Indexes,
    SearchIndexes,
    Expand<
      VectorIndexes &
        Record<
          IndexName,
          {
            vectorField: VectorField;
            dimensions: number;
            filterFields: FilterFields;
          }
        >
    >
  > {
    this.vectorIndexes.push({
      indexDescriptor: name,
      vectorField: indexConfig.vectorField,
      dimensions: indexConfig.dimensions,
      filterFields: indexConfig.filterFields || [],
    });
    return this;
  }

  /**
   * Export the contents of this definition.
   *
   * This is called internally by the Convex framework.
   * @internal
   */
  export() {
    return {
      indexes: this.indexes,
      searchIndexes: this.searchIndexes,
      vectorIndexes: this.vectorIndexes,
      documentType: this.documentType.json,
    };
  }
}

/**
 * Define a table in a schema.
 *
 * You can either specify the schema of your documents as an object like
 * ```ts
 * defineTable({
 *   field: v.string()
 * });
 * ```
 *
 * or as a schema type like
 * ```ts
 * defineTable(
 *  v.union(
 *    v.object({...}),
 *    v.object({...})
 *  )
 * );
 * ```
 *
 * @param documentSchema - The type of documents stored in this table.
 * @returns A {@link TableDefinition} for the table.
 *
 * @public
 */
export function defineTable<
  DocumentSchema extends Validator<Record<string, any>, false, any>
>(
  documentSchema: DocumentSchema
): TableDefinition<
  ExtractDocument<DocumentSchema>,
  ExtractFieldPaths<DocumentSchema>
>;
/**
 * Define a table in a schema.
 *
 * You can either specify the schema of your documents as an object like
 * ```ts
 * defineTable({
 *   field: v.string()
 * });
 * ```
 *
 * or as a schema type like
 * ```ts
 * defineTable(
 *  v.union(
 *    v.object({...}),
 *    v.object({...})
 *  )
 * );
 * ```
 *
 * @param documentSchema - The type of documents stored in this table.
 * @returns A {@link TableDefinition} for the table.
 *
 * @public
 */
export function defineTable<
  DocumentSchema extends Record<string, Validator<any, any, any>>
>(
  documentSchema: DocumentSchema
): TableDefinition<
  ExtractDocument<ObjectValidator<DocumentSchema>>,
  ExtractFieldPaths<ObjectValidator<DocumentSchema>>
>;
export function defineTable<
  DocumentSchema extends
    | Validator<Record<string, any>, false, any>
    | Record<string, Validator<any, any, any>>
>(documentSchema: DocumentSchema): TableDefinition<any, any> {
  if (documentSchema instanceof Validator) {
    return new TableDefinition(documentSchema);
  } else {
    return new TableDefinition(v.object(documentSchema));
  }
}

/**
 * A type describing the schema of a Convex project.
 *
 * This should be constructed using {@link defineSchema}, {@link defineTable},
 * and {@link v}.
 * @public
 */
export type GenericSchema = Record<string, TableDefinition>;

/**
 *
 * The definition of a Convex project schema.
 *
 * This should be produced by using {@link defineSchema}.
 * @public
 */
export class SchemaDefinition<
  Schema extends GenericSchema,
  StrictTableTypes extends boolean
> {
  public tables: Schema;
  public strictTableNameTypes!: StrictTableTypes;
  private readonly schemaValidation: boolean;

  /**
   * @internal
   */
  constructor(tables: Schema, options?: DefineSchemaOptions<StrictTableTypes>) {
    this.tables = tables;
    this.schemaValidation =
      options?.schemaValidation === undefined ? true : options.schemaValidation;
  }

  /**
   * Export the contents of this definition.
   *
   * This is called internally by the Convex framework.
   * @internal
   */
  export(): string {
    return JSON.stringify({
      tables: Object.entries(this.tables).map(([tableName, definition]) => {
        const { indexes, searchIndexes, vectorIndexes, documentType } =
          definition.export();
        return {
          tableName,
          indexes,
          searchIndexes,
          vectorIndexes,
          documentType,
        };
      }),
      schemaValidation: this.schemaValidation,
    });
  }
}

/**
 * Options for {@link defineSchema}.
 *
 * @public
 */
export interface DefineSchemaOptions<StrictTableNameTypes extends boolean> {
  /**
   * Whether Convex should validate at runtime that all documents match
   * your schema.
   *
   * If `schemaValidation` is `true`, Convex will:
   * 1. Check that all existing documents match your schema when your schema
   * is pushed.
   * 2. Check that all insertions and updates match your schema during mutations.
   *
   * If `schemaValidation` is `false`, Convex will not validate that new or
   * existing documents match your schema. You'll still get schema-specific
   * TypeScript types, but there will be no validation at runtime that your
   * documents match those types.
   *
   * By default, `schemaValidation` is `true`.
   */
  schemaValidation?: boolean;

  /**
   * Whether the TypeScript types should allow accessing tables not in the schema.
   *
   * If `strictTableNameTypes` is `true`, using tables not listed in the schema
   * will generate a TypeScript compilation error.
   *
   * If `strictTableNameTypes` is `false`, you'll be able to access tables not
   * listed in the schema and their document type will be `any`.
   *
   * `strictTableNameTypes: false` is useful for rapid prototyping.
   *
   * Regardless of the value of `strictTableNameTypes`, your schema will only
   * validate documents in the tables listed in the schema. You can still create
   * and modify other tables on the dashboard or in JavaScript mutations.
   *
   * By default, `strictTableNameTypes` is `true`.
   */
  strictTableNameTypes?: StrictTableNameTypes;
}

/**
 * Define the schema of this Convex project.
 *
 * This should be exported from a `schema.ts` file in your `convex/` directory
 * like:
 *
 * ```ts
 * export default defineSchema({
 *   ...
 * });
 * ```
 *
 * @param schema - A map from table name to {@link TableDefinition} for all of
 * the tables in this project.
 * @param options - Optional configuration. See {@link DefineSchemaOptions} for
 * a full description.
 * @returns The schema.
 *
 * @public
 */
export function defineSchema<
  Schema extends GenericSchema,
  StrictTableNameTypes extends boolean = true
>(
  schema: Schema,
  options?: DefineSchemaOptions<StrictTableNameTypes>
): SchemaDefinition<Schema, StrictTableNameTypes> {
  return new SchemaDefinition(schema, options);
}

/**
 * Internal type used in Convex code generation!
 *
 * Convert a {@link SchemaDefinition} into a {@link server.GenericDataModel}.
 *
 * @public
 */
export type DataModelFromSchemaDefinition<
  SchemaDef extends SchemaDefinition<any, boolean>
> = MaybeMakeLooseDataModel<
  {
    [TableName in keyof SchemaDef["tables"] &
      string]: SchemaDef["tables"][TableName] extends TableDefinition<
      infer Document,
      infer FieldPaths,
      infer Indexes,
      infer SearchIndexes,
      infer VectorIndexes
    >
      ? {
          // We've already added all of the system fields except for `_id`.
          // Add that here.
          document: Expand<IdField<TableName> & Document>;
          fieldPaths: keyof IdField<TableName> | FieldPaths;
          indexes: Expand<Indexes & SystemIndexes>;
          searchIndexes: SearchIndexes;
          vectorIndexes: VectorIndexes;
        }
      : never;
  },
  SchemaDef["strictTableNameTypes"]
>;

type MaybeMakeLooseDataModel<
  DataModel extends GenericDataModel,
  StrictTableNameTypes extends boolean
> = StrictTableNameTypes extends true
  ? DataModel
  : Expand<DataModel & AnyDataModel>;

const systemSchema = defineSchema({
  _scheduled_functions: defineTable({
    name: v.string(),
    args: v.array(v.any()),
    scheduledTime: v.float64(),
    completedTime: v.optional(v.float64()),
    state: v.union(
      v.object({ kind: v.literal("pending") }),
      v.object({ kind: v.literal("inProgress") }),
      v.object({ kind: v.literal("success") }),
      v.object({ kind: v.literal("failed"), error: v.string() }),
      v.object({ kind: v.literal("canceled") })
    ),
  }),
  _storage: defineTable({
    sha256: v.string(),
    size: v.float64(),
    contentType: v.optional(v.string()),
  }),
});

export type SystemDataModel = DataModelFromSchemaDefinition<
  typeof systemSchema
>;
export type SystemTableNames = TableNamesInDataModel<SystemDataModel>;
