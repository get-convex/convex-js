import { GenericId } from "../values/index.js";
import { test } from "@jest/globals";
import { assert, Equals } from "../test/type_testing.js";
import { DatabaseReader } from "./database.js";

type Message = {
  body: string;
  _id: GenericId<"tableName">;
};
type DataModel = {
  messages: {
    document: Message;
    fieldPaths: "body" | "_id";
    // eslint-disable-next-line @typescript-eslint/ban-types
    indexes: {};
    // eslint-disable-next-line @typescript-eslint/ban-types
    searchIndexes: {};
    // eslint-disable-next-line @typescript-eslint/ban-types
    vectorIndexes: {};
  };
};
type DB = DatabaseReader<DataModel>;

test("collect returns the correct types", () => {
  function collect(db: DB) {
    return db.query("messages").collect();
  }
  type Result = ReturnType<typeof collect>;
  type Expected = Promise<Message[]>;
  assert<Equals<Result, Expected>>();
});

test("take returns the correct types", () => {
  function take(db: DB) {
    return db.query("messages").take(5);
  }
  type Result = ReturnType<typeof take>;
  type Expected = Promise<Message[]>;
  assert<Equals<Result, Expected>>();
});
test("first returns the correct types", () => {
  function first(db: DB) {
    return db.query("messages").first();
  }
  type Result = ReturnType<typeof first>;
  type Expected = Promise<Message | null>;
  assert<Equals<Result, Expected>>();
});

test("unique returns the correct types", () => {
  function unique(db: DB) {
    return db.query("messages").unique();
  }
  type Result = ReturnType<typeof unique>;
  type Expected = Promise<Message | null>;
  assert<Equals<Result, Expected>>();
});

test("fullTableScan returns the correct types", () => {
  function fullTableScan(db: DB) {
    return db.query("messages").fullTableScan().collect();
  }
  type Result = ReturnType<typeof fullTableScan>;
  type Expected = Promise<Message[]>;
  assert<Equals<Result, Expected>>();
});

test("order and filter don't change the return type", () => {
  function orderAndFilter(db: DB) {
    return db
      .query("messages")
      .order("desc")
      .filter((q) => q.eq(q.field("body"), "Hello"))
      .collect();
  }
  type Result = ReturnType<typeof orderAndFilter>;
  type Expected = Promise<Message[]>;
  assert<Equals<Result, Expected>>();
});
