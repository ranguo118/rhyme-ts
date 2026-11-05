// binary operators: ast key, precedence (higher binds tighter),

import * as utils from "./utils";
import * as ast from "./ast";
import type { Expr } from "./ast";
import type { PureOp } from "./ops";

type binopEntry = {
  readonly key: PureOp;
  readonly prec: number;
  readonly assoc: number;
};

// and associativity (1 for left, 0 for right)
const binops: Readonly<Record<string, binopEntry>> = {
  "|": { key: "pipe", prec: 40, assoc: 1 },
  "&": { key: "and", prec: 50, assoc: 1 }, // low prec, could give it some other grouping semantics

  "||": { key: "orElse", prec: 70, assoc: 1 },
  "&&": { key: "andAlso", prec: 80, assoc: 1 },

  "<": { key: "lt", prec: 90, assoc: 1 },
  "<=": { key: "le", prec: 90, assoc: 1 },
  ">": { key: "gt", prec: 90, assoc: 1 },
  ">=": { key: "ge", prec: 90, assoc: 1 },
  "==": { key: "eq", prec: 90, assoc: 1 },
  "!=": { key: "ne", prec: 90, assoc: 1 },

  "::": { key: "concat", prec: 95, assoc: 1 },
  "+": { key: "plus", prec: 100, assoc: 1 },
  "-": { key: "minus", prec: 100, assoc: 1 },
  "*": { key: "times", prec: 200, assoc: 1 },
  "/": { key: "fdiv", prec: 200, assoc: 1 }, // float div by default
  "//": { key: "div", prec: 200, assoc: 1 }, // integer division
  "%": { key: "mod", prec: 200, assoc: 1 },
};

function astBinop(op: string, a: Expr, b: Expr): Expr {
    let op1 = binops[op]?.key ?? op;
    return ast.op(op1, [a, b]);
}

function astPostop(op: string, a: Expr): Expr {
  if (op == "?" && !ast.isOpNode(a) && a._rhKey == "ident") {
    return ast.ident(a._rhOp + "?");
  } else if (op == "?" && ast.isOpNode(a) && a._rhKey == "get") {
    return ast.op("get?", a._rhParam);
  }
  return ast.op(op, [a]);
}
