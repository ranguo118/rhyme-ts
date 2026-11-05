import type { Expr, Ident } from "./ast";
import * as ast from "./ast";
import { isPureOp, isSpecialOpFull, isStatefulOpFull } from "./ops";
import * as utils from "./utils";

// NOTE: in general, desugar preserves only _rhKey and _rhParam fields.
// Field _rhOp is only preserved for ident, raw, const.

export function desugar(p: Expr): Expr {
  let argProvided: Expr = ast.root();
  let argUsed = false;
  let env: ast.Env = {};

  // contract: args are already desugared
  function transPath(p: string, args: readonly Expr[]) {
    if (p == "get" || p == "get?") {
      let [e1, ...e2s] = args;
      if (e1 === undefined)
        utils.error("malformed get params: " + JSON.stringify(args));
      // incomplete path like '.foo' ? implicit hole, treat as function!
      if (e2s.length == 0 || e2s[0] === undefined) {
        // implicit hole = argument ref
        e2s = [e1];
        e1 = argProvided;
        argUsed = true;
      }
      // selecting on an ident like 'input.foo' ? implicit root field access
      if (e1._rhKey == "ident") e1 = ast.op(p, [ast.root(), e1]);
      return ast.op(p, [e1, ...e2s]);
    } else {
      return ast.op(p, args);
    }
  }

  // // contract: args are already desugared
  // function transStateful(p, args) {
  //   return { _rhKey: p, _rhParam: args }
  // }

  // contract: args are already desugared, p is an ident
  function transPrimitiveApply(p: string, args: readonly Expr[]): Expr {
    if (p == "get" || p == "get?") {
      // XXX others? plus, minus, etc?
      return transPath(p, args);
    } else if (isStatefulOpFull(p)) {
      return ast.op(p, args);
    } else if (isPureOp(p)) {
      return ast.op(p, args);
    } else if (isSpecialOpFull(p)) {
      return ast.op(p, args);
      // this branch is unreachable
      // } else if (p == "group" && args.length < 2) {
      //   // partial application -- this will later turn into a keyval object
      //   return { _rhKey: "group", _rhParam: args }
    } else {
      return {
        _rhKey: "apply",
        _rhParam: [{ _rhKey: "ident", _rhOp: p }, ...args],
      };
    }
  }

  // contract: args are already desugared, p is not
  function transFuncApply(p: Expr, args: Expr[]): Expr {
    const [arg0, ...rest] = args;
    if (arg0 === undefined)
      utils.error("function applied to no arguments: " + JSON.stringify(p));

    // Desugar p with arg0 as the implicit argument of incomplete paths like
    // '.foo' (see transPath), and record whether it was used. Saved and
    // restored around the call, since trans recurses.
    // (The original's `[argProvided, argUsed] = save` "didn't work" because,
    // without semicolons, it parsed as `argUsed[argProvided, argUsed] = save`.)
    const saved = { argProvided, argUsed };
    argProvided = arg0; // XXX what about the others?
    argUsed = false;
    const f: Expr = trans(p);
    const used = argUsed;
    ({ argProvided, argUsed } = saved);

    // is it a present-stage function, spliced into a hole via ${f} ?
    if (!ast.isOpNode(f) && f._rhKey == "hole" && typeof f._rhOp == "function")
      return ast.unwrap(f._rhOp(...args.map(ast.wrap)));

    // is the argument used? i.e. syntax '.foo' --> we have 'arg.foo', just return
    if (used) return f; // XXX apply to remaining args, if any?

    // argument not used yet: i.e. syntax 'udf.fun' --> apply to arg, return 'udf.fun(arg)'
    if (ast.isOpNode(f)) {
      const [p0, ...ps] = f._rhParam;
      if (f._rhKey == "get" && p0 !== undefined && ps.length == 0) {
        // partially applied, i.e. 'get(*line)'
        return ast.get(arg0, p0);
      } else if (f._rhKey == "group") {
        // partially applied, i.e. 'group(*line)'
        if (p0 === undefined)
          utils.error("malformed group: " + JSON.stringify(f));
        return ast.object([p0, arg0]);
      }
    } else if (f._rhKey == "ident") {
      return transPrimitiveApply(f._rhOp, args);
    } else if (f._rhKey == "closure") {
      // fn x body: bind x to the first arg in the closure's own env
      const [env1, x, body] = f._rhParam;
      if (ast.isOpNode(x) || x._rhKey != "ident")
        utils.error("closure parameter must be an ident: " + JSON.stringify(x));
      const save = env;
      env = { ...env1, [x._rhOp]: arg0 };
      const res: Expr = trans(body);
      env = save;
      if (rest.length > 0) return transFuncApply(res, rest);
      return res;
    }

    return ast.op("apply", [f, ...args]);
  }

  // ident, optionally with the given name
  const isIdent = (e: Expr | undefined, name?: string): e is Ident =>
    e !== undefined &&
    !ast.isOpNode(e) &&
    e._rhKey == "ident" &&
    (name === undefined || e._rhOp == name);

  // contract: neither p nor args are desugared
  function transApply(p: Expr, args: readonly Expr[]): Expr {
    // special non-cbv forms can be added here
    if (isIdent(p, "let")) {
      // let x rhs body
      // contract: rhs gets evaluated here
      const [x, rhs, body, ...args1] = args;
      if (!isIdent(x) || rhs === undefined || body === undefined)
        utils.error("malformed let: " + JSON.stringify(args));
      const e2: Expr = trans(rhs);
      const save = env;
      env = { ...env, [x._rhOp]: e2 };
      const res: Expr = trans(body);
      env = save;
      if (args1.length > 0) return transApply(res, args1);
      return res;
    } else if (isIdent(p, "fn")) {
      // fn x body
      const [x, body, ...args1] = args;
      if (!isIdent(x) || body === undefined)
        utils.error("malformed fn: " + JSON.stringify(args));
      // closes over the current env; the body is desugared when the
      // closure is applied (transFuncApply)
      const res = ast.closure(env, x, body);
      if (args1.length > 0) return transApply(res, args1);
      return res;
    } else if (ast.isOpNode(p) && p._rhKey == "apply") {
      // collect all arguments for curried apply
      const [p1, ...args1] = p._rhParam;
      if (p1 === undefined)
        utils.error("malformed apply: " + JSON.stringify(p));
      return transApply(p1, [...args1, ...args]);
    }
    return transFuncApply(
      p,
      args.map((e) => trans(e)),
    );
  }

  function transPipe(p: Expr, args: Expr[]): Expr {
    // special non-cbv pipe forms can be added here
    // (args[0] is the arg on the left of the pipe, rest currently empty)
    console.assert(args.length == 1);
    return transFuncApply(p, args.map(trans));
  }

  function trans(p: Expr): Expr {
    if (ast.isOpNode(p)) {
      switch (p._rhKey) {
        case "pipe": {
          const [e1, e2, ...e3s] = p._rhParam;
          if (e1 === undefined || e2 === undefined)
            utils.error("malformed pipe: " + JSON.stringify(p));
          return transPipe(e2, [e1, ...e3s]);
        }
        case "apply": {
          const [e1, ...e2s] = p._rhParam;
          if (e1 === undefined)
            utils.error("malformed apply: " + JSON.stringify(p));
          return transApply(e1, e2s);
        }
        default:
          return transPath(
            p._rhKey,
            p._rhParam.map((e) => trans(e)),
          );
      }
    }
    switch (p._rhKey) {
      case "ident": {
        // own properties only: plain-object env, so 'in' would also find
        // Object.prototype members for idents like 'toString', 'constructor'
        const bound = Object.hasOwn(env, p._rhOp) ? env[p._rhOp] : undefined;
        return bound ?? p;
      }
      case "raw":
        // if (p._rhOp == "_ARG_") {
        //   argUsed = true
        //   return argProvided
        // }
        return p;
      case "const":
        return p;
      case "hole":
        return ast.unwrap(p._rhOp); // do not recurse, already desugared
      case "closure":
        // do not recurse: the env is not an ast, and the body is desugared
        // in the closure's own env when it is applied (transFuncApply)
        return p;
      default: {
        const unhandled: never = p;
        utils.error("unhandled ast node " + JSON.stringify(unhandled));
      }
    }
  }

  return trans(p);
}
