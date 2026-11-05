import * as ast from "./ast";
import * as ops from "./ops";
import type { Expr, OpNode } from "./ast";
import type { IR } from "./ir";
import * as utils from "./utils";
import { parse } from "./parser";

const isVar = (s: string) => s.startsWith("*");
let settings: Record<string, any>;

function resolveHole(p: unknown): Expr {
  if (p === true || p === false) {
    return ast.constant(p);
  } else if (Array.isArray(p) && p.length == 0) {
    return ast.constant([]);
  } else if (typeof p === "number" /*|| !Number.isNaN(Number(p))*/) {
    // number?
    return ast.constant(Number(p));
  } else if (typeof p === "string") {
    // if (p == "-" || p == "$display") return { xxkey: "const", xxop: p };
    return ast.unwrap(parse(p)); // includes desugaring, i.e., no internal holes left
  } else if ((typeof p === "object" && p !== null) || typeof p === "function") {
    // treat fct as obj
    if (ast.isAst(p)) {
      return ast.unwrap(p);
    } else if (Array.isArray(p)) {
      return ast.array(p.map(ast.unwrap));
    } else {
      if (ast.isExpr(p))
        utils.error("double wrapping of ast node " + JSON.stringify(p));
      return ast.object(Object.entries(p).flat().map(ast.unwrap));
    }
  } else {
    utils.error("unknown object in query hole: " + JSON.stringify(p)); // user-facing error
  }
}

function preproc(q: Expr): IR {
  if (ast.isOpNode(q)) return preprocOp(q);
  switch (q._rhKey) {
    case "raw":
      if (q._rhOp === "inp") return { key: "input" };
      utils.error("unexpected raw input: " + JSON.stringify(q));
    case "const":
      if (q._rhOp === false) return { key: "const", op: undefined };
      return { key: "const", op: q._rhOp };
    case "ident":
      if (isVar(q._rhOp)) return { key: "var", op: q._rhOp };
      return { key: "const", op: q._rhOp };
    case "hole":
      return preproc(resolveHole(q._rhOp));
    case "closure":
      utils.error("unexpected closure leaked to preprocess");
    default: {
      const unhandled: never = q;
      utils.error("unhandled ast node " + JSON.stringify(unhandled));
    }
  }
}

function preprocOp(q: OpNode): IR {
  if (q._rhKey == "loadJSON") {
    if (q._rhParam[0] === undefined)
      utils.error("malformed op " + JSON.stringify(q));
    let e1 = preproc(q._rhParam[0]);
    const schema = q._rhParam[1];
    if (
      schema === undefined ||
      schema._rhKey !== "hole" ||
      ast.isOpNode(schema)
    )
      utils.error("schema expected for " + JSON.stringify(q));
    return {
      key: "loadInput",
      op: "json",
      arg: [e1],
      inputSchema: schema._rhOp,
    };
  } else if (q._rhKey === "get" || q._rhKey === "get?") {
    if (q._rhParam[0] === undefined)
      utils.error("malformed op " + JSON.stringify(q));
    let e1 = preproc(q._rhParam[0]);
    let e2;
    if (q._rhParam[1] === undefined) {
      e2 = e1;
      e1 = { key: "input" };
    } else e2 = preproc(q._rhParam[1]);
    if (q._rhKey === "get") return { key: "get", arg: [e1, e2] };
    else return { key: "get", arg: [e1, e2], mode: "maybe" };
  } else if (q._rhKey == "apply") {
    if (q._rhParam[0] === undefined)
      utils.error("malformed op " + JSON.stringify(q));
    let [q1, ...qs2] = q._rhParam;
    let e1 = preproc(q1);
    if (e1.key == "const")
      // built-in ops are resolved by desugar, so a constant head here
      // names something that is not an op
      utils.error("unknown function " + JSON.stringify(q1));
    else
      // udf apply
      return { key: "pure", op: "apply", arg: [e1, ...qs2.map(preproc)] };
  } else if (q._rhKey == "array") {
    let p = q._rhParam;
    if (p.length == 1 && p[0] !== undefined)
      return { key: "stateful", op: "array", arg: [preproc(p[0])] };
    else
      return {
        key: "pure",
        op: "flatten",
        arg: p.map((x) => preproc(ast.array([x]))),
      };
  } else if (q._rhKey == "object") {
    let res: IR = { key: "const", op: {} };
    let constKeys = true;
    let arg = [];
    for (let i = 0; i < q._rhParam.length; i += 2) {
      let k = q._rhParam[i];
      let v = q._rhParam[i + 1];
      if (k === undefined || v === undefined)
        utils.error("malformed op " + JSON.stringify(q));
      // { _: merge(k1, v1) } / { _: keyval(k1, v1) }: the entry is k1: v1,
      // the outer key is ignored. Checked on the ast, since merge/keyval
      // have no IR node. TODO: support 'flatten'
      if (v._rhKey === "merge" || v._rhKey === "keyval") {
        const [k1, v1] = v._rhParam;
        if (k1 === undefined || v1 === undefined || v._rhParam.length > 2)
          utils.error("malformed op " + JSON.stringify(v));
        k = k1;
        v = v1;
      }
      // TODO: an array key ({ [*a, *b]: ... }) should become a composite
      // key, pure combine(*a, *b), as in the original; it currently becomes
      // an array aggregation. Needs 'combine' as an IR pure op.
      let e1 = preproc(k);
      let e2 = preproc(v);
      if (e1.key != "const") constKeys = false;
      arg.push(e1);
      arg.push(e2);
      res = { key: "update", arg: [res, e1, e2] };
    }
    // An all-constant-key record can be built in one step instead of as a
    // chain of updates. The two must stay observationally equal, so this is
    // a switch, not a semantic choice.
    if (settings.mkTuple && q._rhParam.length > 0 && constKeys)
      return { key: "mkTuple", arg };
    return res;
  } else {
    // if 'update .. ident ..', convert ident to input ref?
    let op = q._rhKey;
    // if (op in ops.pure && op == "sort") {
    //   let e1 = q.xxparam[0].xxkey == "array" ? { key: "pure", op: "combine", arg: q.xxparam[0].xxparam.map(preproc) } : preproc(q.xxparam[0])
    //   let e2 = preproc(q.xxparam[1])
    //   return { key: "pure", op: op, arg: [e1, e2] }
    // }
    let es2 = q._rhParam.map(preproc);
    if (ops.isSpecialOpFull(op)) {
      // get, get? and loadJSON are handled above
      switch (op) {
        case "group":
        case "group?": {
          // group(k, e), group(e) -> group(*, e); group? -> mode 'maybe'
          const [e1, e2] = es2;
          if (e1 === undefined || es2.length > 2)
            utils.error("malformed op " + JSON.stringify(q));
          const [k, v]: [IR, IR] =
            e2 === undefined
              ? [{ key: "placeholder", op: "*", arg: [] }, e1]
              : [e1, e2];
          if (op === "group?")
            return { key: "group", arg: [k, v], mode: "maybe" };
          return { key: "group", arg: [k, v] };
        }
        case "update":
        case "update_inplace": {
          const [e0, e1, e2] = es2;
          if (
            e0 === undefined ||
            e1 === undefined ||
            e2 === undefined ||
            es2.length > 3
          )
            utils.error("malformed op " + JSON.stringify(q));
          if (op === "update_inplace")
            return { key: "update", arg: [e0, e1, e2], mode: "inplace" };
          return { key: "update", arg: [e0, e1, e2] };
        }
        case "merge":
        case "keyval":
          // no IR node: only meaningful as an object value, where the
          // object case would splice its key and value into the update
          utils.error(
            op + " is only supported as an object value: " + JSON.stringify(q),
          );
        case "get":
        case "get?":
        case "loadJSON":
          utils.error("unreachable: " + op + " is handled above");
        default: {
          const unhandled: never = op;
          utils.error("unhandled special op " + unhandled);
        }
      }
    } else if (ops.isPureOp(op)) {
      return { key: "pure", op: op, arg: es2 };
    } else if (ops.isStatefulOp(op)) {
      if (es2.length !== 1 || es2[0] === undefined)
        utils.error("malformed op " + JSON.stringify(q));
      return { key: "stateful", op: op, arg: [es2[0]] };
    } else if (ops.isStatefulOpFull(op)) {
      // sum?         -> stateful sum, mode 'maybe'
      // prefix_sum   -> prefix sum
      // prefix_sum?  -> prefix sum, mode 'maybe'
      // (The original passed "sum?" through as the prefix op, generating
      // `rt.stateful.sum?(...)`, which JS reads as an optional call.)
      const isPrefix = op.startsWith("prefix_");
      const name = isPrefix ? op.slice("prefix_".length) : op;
      const maybe = name.endsWith("?");
      const base = maybe ? name.slice(0, -1) : name;
      if (!ops.isStatefulOp(base))
        utils.error("unknown stateful op " + JSON.stringify(q));
      const [e1] = es2;
      if (es2.length !== 1 || e1 === undefined)
        utils.error("malformed op " + JSON.stringify(q));
      const m = maybe ? { mode: "maybe" as const } : {};
      if (isPrefix) return { key: "prefix", op: base, arg: [e1], ...m };
      return { key: "stateful", op: base, arg: [e1], ...m };
    }
    utils.error("malformed op " + JSON.stringify(q));
  }
}

export function preprocess(q: Expr, userSettings: Record<string, any>) {
  settings = { ...userSettings };
  return preproc(q);
}
