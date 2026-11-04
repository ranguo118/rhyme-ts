import { expect, test } from "bun:test";
import { q, compile } from "../src/rhyme";

test("a test", () => {
  let f = compile(q.plus(1, 1));
  console.log(f);
});
