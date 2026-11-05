//
// ---------- ast creation api (used by parser, test suite) ----------
//
// Ported from rhyme/src/shared.js (`ast`) and rhyme/src/rhyme.js (`ast_op`,
// `ast_op_wrapped`).
//

import type { Op } from "./ops";

// internal ast node
//
//  leaves carry their payload in `_rhOp`:
//    ident  - identifier name
//    raw    - raw target-code name (e.g. "inp")
//    const  - number / string / boolean literal
//    hole   - arbitrary user value spliced into the query
//
//  everything else is an op node with children in `_rhParam`

export interface Ident {
  readonly _rhKey: "ident";
  readonly _rhOp: string;
}

export interface Raw {
  readonly _rhKey: "raw";
  readonly _rhOp: string;
}

export interface Const {
  readonly _rhKey: "const";
  readonly _rhOp: number | string | boolean | readonly []; // [] from resolving an empty-array hole
}

export interface Hole {
  readonly _rhKey: "hole";
  readonly _rhOp: unknown;
}

// fn x body, closed over its definition environment (desugar)
export interface Closure {
  readonly _rhKey: "closure";
  readonly _rhParam: readonly [env: unknown, arg: Expr, body: Expr]; // env is not an AST
}

// keys of the built-in ops (used by the q.* builders). The ast itself is
// open: an OpNode may carry any key, the parser emits whatever was written
// and preprocess decides whether it means anything.
export type OpKey = Op;

export type Leaf = Ident | Raw | Const | Hole;

export interface OpNode {
  readonly _rhKey: string;
  readonly _rhParam: readonly Expr[];
}

export type Expr = Leaf | Closure | OpNode;

// Since OpNode's `_rhKey` is `string`, comparing `_rhKey` against a leaf key
// does not narrow (`"ident"` is also a string). Split on shape first:
//
//   if (isOpNode(q)) { q._rhParam ... } else { switch (q._rhKey) ... }
//
// Closure also has `_rhParam`, but its first param is not an ast.
export const isOpNode = (e: Expr): e is OpNode =>
  "_rhParam" in e && e._rhKey !== "closure";

// external (user-facing) syntax object
export interface Ast {
  readonly _rhymeAst: Expr;
}

// We trust that the user passed in a well-shaped AST here
// TODO: do a validation pass over the AST
export const isAst = (e: unknown): e is Ast =>
  typeof e === "object" && e !== null && "_rhymeAst" in e;

export const isExpr = (e: unknown): e is Expr =>
  typeof e === "object" && e !== null && "_rhKey" in e && !!e._rhKey;

// wrap internal ast -> external syntax object
export const wrap = (e: Expr): Ast => {
  console.assert(!!e._rhKey);
  return { _rhymeAst: e };
};

// unwrap external syntax object -> internal ast
// anything that isn't a wrapped syntax object becomes a hole
export const unwrap = (e: unknown): Expr => {
  if (isAst(e)) return e._rhymeAst;
  if (isExpr(e))
    console.error("ERROR: double wrapping of ast node " + JSON.stringify(e));
  return hole(e);
};

// leaves

export const ident = (a: string): Ident => ({ _rhKey: "ident", _rhOp: a });
export const raw = (a: string): Raw => ({ _rhKey: "raw", _rhOp: a });
export const root = (): Raw => raw("inp");
export const hole = (a: unknown): Hole => ({ _rhKey: "hole", _rhOp: a });
export const constant = (
  a: number | boolean | string | readonly [],
): Const => ({
  _rhKey: "const",
  _rhOp: a,
});

// op nodes

export const op = (key: string, param: readonly Expr[]): OpNode => ({
  _rhKey: key,
  _rhParam: param,
});

// op builder over wrapped syntax objects: opWrapped("sum")(x) etc.
export const opWrapped =
  (key: OpKey) =>
  (...param: unknown[]): Ast =>
    wrap(op(key, param.map(unwrap)));

export const get = (a: Expr, b?: Expr): OpNode =>
  op("get", b === undefined ? [a] : [a, b]);
export const apply = (a: Expr, b: Expr): OpNode => op("apply", [a, b]);
export const call = apply;
export const array = (as: readonly Expr[]): OpNode => op("array", as);
export const object = (as: readonly Expr[]): OpNode => op("object", as);
export const plus = (a: Expr, b: Expr): OpNode => op("plus", [a, b]);

export const closure = (env: unknown, arg: Expr, body: Expr): Closure => ({
  _rhKey: "closure",
  _rhParam: [env, arg, body],
});
