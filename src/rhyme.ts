import * as ast from "./ast";
import type { Ast, OpKey } from "./ast";
import { specialOpsFull, pureOps, statefulOpsFull } from "./ops";
import * as driver from "./driver";
export { rh } from "./parser";

//
// ---------- Function-based syntax object API ----------
//

type OpBuilder = (...param: readonly unknown[]) => Ast;

// Create a syntax API entry for every op in `names`, e.g.
//
//  api.get(a,b)
//  api.sum(a)
//  ...
const opBuilders = <K extends OpKey>(names: readonly K[]) =>
  Object.fromEntries(names.map((k) => [k, ast.opWrapped(k)])) as Record<
    K,
    OpBuilder
  >;

const builders = {
  ...opBuilders(specialOpsFull),
  ...opBuilders(pureOps),
  ...opBuilders(statefulOpsFull),
};

export const q = {
  ...builders,

  // some overrides:

  // user-facing order is (value, key), the ast node takes (key, value)
  group: (e: unknown, k?: unknown): Ast =>
    k === undefined ? builders.group(e) : builders.group(k, e),
  "group?": (e: unknown, k?: unknown): Ast =>
    k === undefined ? builders["group?"](e) : builders["group?"](k, e),
  input: (): Ast => ast.wrap(ast.root()),
};

export const pipe = {};

export function compile(src: unknown, settings?: Record<string, any>) {
  return driver.compile(src, settings ?? {});
}
