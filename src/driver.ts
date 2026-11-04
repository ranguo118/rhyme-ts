import * as ast from "./ast";
import type { Ast, Expr } from "./ast";
import { preprocess } from "./preprocess";

export function compile(src: unknown, settings: Record<string, any>) {
  const q = ast.unwrap(src);

  let ir = preprocess(q, settings);

  function wrapper(inp: any) {
    return undefined;
  }
  wrapper.explain = {};

  return wrapper;
}
