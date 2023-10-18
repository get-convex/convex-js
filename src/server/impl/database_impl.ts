import {
  convexToJson,
  GenericId,
  jsonToConvex,
  Value,
} from "../../values/index.js";
import { performAsyncSyscall, performSyscall } from "./syscall.js";
import { DatabaseReader, DatabaseWriter } from "../database.js";
import { QueryInitializerImpl } from "./query_impl.js";
import { GenericDataModel, GenericDocument } from "../data_model.js";
import { validateArg } from "./validate.js";
import { patchValueToJson } from "../../values/value.js";

export function setupReader(): DatabaseReader<GenericDataModel> {
  return {
    get: async (id: GenericId<string>) => {
      validateArg(id, 1, "get", "id");
      if (typeof id !== "string") {
        throw new Error(
          `Invalid argument \`id\` for \`db.get\`, expected string but got '${typeof id}': ${
            id as any
          }`
        );
      }
      const args = { id: convexToJson(id) };
      const syscallJSON = await performAsyncSyscall("1.0/get", args);
      return jsonToConvex(syscallJSON, true) as GenericDocument;
    },
    query: (tableName: string) => new QueryInitializerImpl(tableName),
    normalizeId: <TableName extends string>(
      tableName: TableName,
      id: string
    ): GenericId<TableName> | null => {
      validateArg(tableName, 1, "normalizeId", "tableName");
      validateArg(id, 2, "normalizeId", "id");
      const syscallJSON = performSyscall("1.0/db/normalizeId", {
        table: tableName,
        idString: id,
      });
      const syscallResult = jsonToConvex(syscallJSON, false) as any;
      return syscallResult.id;
    },
  };
}

export function setupWriter(): DatabaseWriter<GenericDataModel> {
  const reader = setupReader();
  return {
    get: reader.get,
    query: reader.query,
    normalizeId: reader.normalizeId,

    insert: async (table, value) => {
      validateArg(table, 1, "insert", "table");
      validateArg(value, 2, "insert", "value");
      const syscallJSON = await performAsyncSyscall("1.0/insert", {
        table,
        value: convexToJson(value),
      });
      const syscallResult = jsonToConvex(syscallJSON, false) as any;
      return syscallResult._id;
    },
    patch: async (id, value) => {
      validateArg(id, 1, "patch", "id");
      validateArg(value, 2, "patch", "value");
      await performAsyncSyscall("1.0/shallowMerge", {
        id: convexToJson(id),
        value: patchValueToJson(value as Value),
      });
    },
    replace: async (id, value) => {
      validateArg(id, 1, "replace", "id");
      validateArg(value, 2, "replace", "value");
      await performAsyncSyscall("1.0/replace", {
        id: convexToJson(id),
        value: convexToJson(value),
      });
    },
    delete: async (id) => {
      validateArg(id, 1, "delete", "id");
      await performAsyncSyscall("1.0/remove", { id: convexToJson(id) });
    },
  };
}
