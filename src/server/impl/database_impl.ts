import {
  convexToJson,
  GenericId,
  jsonToConvex,
  Value,
} from "../../values/index.js";
import { performAsyncSyscall } from "./syscall.js";
import { DatabaseReader, DatabaseWriter } from "../database.js";
import { QueryInitializerImpl } from "./query_impl.js";
import { GenericDataModel, GenericDocument } from "../data_model.js";
import { validateArg } from "./validate.js";

export function setupReader(): DatabaseReader<GenericDataModel> {
  return {
    get: async (id: GenericId<string>) => {
      validateArg(id, 1, "get", "id");
      if (!(id instanceof GenericId)) {
        throw new Error(
          `Invalid argument \`id\` for \`db.get\` "${typeof id} ${id}`
        );
      }
      const args = { id: convexToJson(id) };
      const syscallJSON = await performAsyncSyscall("get", args);
      return jsonToConvex(syscallJSON) as GenericDocument;
    },
    query: (tableName: string) => new QueryInitializerImpl(tableName),
  };
}

export function setupWriter(): DatabaseWriter<GenericDataModel> {
  const reader = setupReader();
  return {
    get: reader.get,
    query: reader.query,

    insert: async (table, value) => {
      validateArg(table, 1, "insert", "table");
      validateArg(value, 2, "insert", "value");
      const syscallJSON = await performAsyncSyscall("insert", {
        table,
        value: convexToJson(value),
      });
      const syscallResult = jsonToConvex(syscallJSON) as any;
      return syscallResult._id;
    },
    patch: async (id, value) => {
      validateArg(id, 1, "patch", "id");
      validateArg(value, 2, "patch", "value");
      await performAsyncSyscall("update", {
        id: convexToJson(id),
        value: convexToJson(value as Value),
      });
    },
    replace: async (id, value) => {
      validateArg(id, 1, "replace", "id");
      validateArg(value, 2, "replace", "value");
      await performAsyncSyscall("replace", {
        id: convexToJson(id),
        value: convexToJson(value),
      });
    },
    delete: async id => {
      validateArg(id, 1, "delete", "id");
      await performAsyncSyscall("remove", { id: convexToJson(id) });
    },
  };
}
