import { test, expect } from "@jest/globals";
import { parseProjectConfig } from "./config.js";

test("parseProjectConfig", () => {
  const assertParses = (inp: any) => {
    expect(parseProjectConfig(inp)).toEqual(inp);
  };
  const assertParseError = (inp: any, err: string) => {
    expect(() => parseProjectConfig(inp)).toThrow(err);
  };

  assertParses({
    team: "team",
    project: "proj",
    prodUrl: "prodUrl",
    functions: "functions/",
  });

  assertParses({
    team: "team",
    project: "proj",
    prodUrl: "prodUrl",
    functions: "functions/",
    authInfos: [],
  });

  assertParses({
    team: "team",
    project: "proj",
    prodUrl: "prodUrl",
    functions: "functions/",
    authInfos: [
      {
        applicationID: "hello",
        domain: "world",
      },
    ],
  });

  assertParseError(
    {
      team: 33,
      project: "proj",
      prodUrl: "prodUrl",
      functions: "functions/",
    },
    "Expected team to be a string"
  );
  assertParseError(
    {
      team: "team",
      project: "proj",
      prodUrl: "prodUrl",
      functions: "functions/",
      authInfo: [{}],
    },
    "Expected authInfo to be type AuthInfo[]"
  );
});
