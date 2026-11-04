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
  _rhKey: "ident";
  _rhOp: string;
}

export interface Raw {
  _rhKey: "raw";
  _rhOp: string;
}

export interface Const {
  _rhKey: "const";
  _rhOp: number | string | boolean | []; // [] from resolving an empty-array hole
}

export interface Hole {
  _rhKey: "hole";
  _rhOp: unknown;
}

// fn x body, closed over its definition environment (desugar)
export interface Closure {
  _rhKey: "closure";
  _rhParam: [env: unknown, arg: Expr, body: Expr]; // env is not an AST
}

// keys of op nodes. Must not overlap with the leaf / closure keys above,
// otherwise narrowing on `_rhKey` stops working.
export type OpKey = Op;

export interface OpNode {
  _rhKey: OpKey;
  _rhParam: Expr[];
}

export type Expr = Ident | Raw | Const | Hole | Closure | OpNode;

export type ExprKey = Expr["_rhKey"];

// external (user-facing) syntax object
export interface Ast {
  _rhymeAst: Expr;
}

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
export const constant = (a: number | boolean | string | []): Const => ({
  _rhKey: "const",
  _rhOp: a,
});

// op nodes

export const op = (key: OpKey, param: Expr[]): OpNode => ({
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
export const array = (as: Expr[]): OpNode => op("array", as);
export const object = (as: Expr[]): OpNode => op("object", as);
export const plus = (a: Expr, b: Expr): OpNode => op("plus", [a, b]);

export const closure = (env: unknown, arg: Expr, body: Expr): Closure => ({
  _rhKey: "closure",
  _rhParam: [env, arg, body],
});
