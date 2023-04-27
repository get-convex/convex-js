import { convexToJson, jsonToConvex, Value } from "../../values/index.js";
import { version } from "../../index.js";
import { performAsyncSyscall } from "./syscall.js";
import { parseArgs } from "../../common/index.js";

export function setupActionCalls(requestId: string) {
  return {
    runQuery: async (
      name: string,
      args?: Record<string, Value>
    ): Promise<any> => {
      const queryArgs = parseArgs(args);
      const syscallArgs = {
        name,
        args: [convexToJson(queryArgs)],
        version,
        requestId,
      };
      const result = await performAsyncSyscall("actions/query", syscallArgs);
      return jsonToConvex(result);
    },
    runMutation: async (
      name: string,
      args?: Record<string, Value>
    ): Promise<any> => {
      const mutationArgs = parseArgs(args);
      const syscallArgs = {
        name,
        args: [convexToJson(mutationArgs)],
        version,
        requestId,
      };
      const result = await performAsyncSyscall("actions/mutation", syscallArgs);
      return jsonToConvex(result);
    },
    runAction: async (
      name: string,
      args?: Record<string, Value>
    ): Promise<any> => {
      const actionArgs = parseArgs(args);
      const syscallArgs = {
        name,
        args: [convexToJson(actionArgs)],
        version,
        requestId,
      };
      const result = await performAsyncSyscall("actions/action", syscallArgs);
      return jsonToConvex(result);
    },
  };
}
