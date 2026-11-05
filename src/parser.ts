// binary operators: ast key, precedence (higher binds tighter),

import * as utils from "./utils";
import * as ast from "./ast";
import type { Ast, Expr } from "./ast";
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

export function rh(
  strings: readonly string[],
  ...holes: readonly unknown[]
): Ast {
  return ast.wrap(parseImpl(strings, ...holes));
}

export function parse(src: string): Ast {
  return ast.wrap(parseImpl([src], []));
}

export function parseImpl(
  strings: readonly string[],
  ...holes: readonly unknown[]
): Expr {
  const input = strings.join("\0");
  let pos = 0;
  let peek = "";
  let gap = "";
  let str = "";
  let start = 0;
  let hole = -1;

  const opchars = "+-*/%<>=!?|&^~:";
  const optable = new Set(opchars);

  function whitespace() {
    let iswhitespace = () =>
      input[pos] == " " ||
      input[pos] == "\n" ||
      input[pos] == "\t" ||
      input[pos] == "\r";
    let start = pos;
    while (iswhitespace()) ++pos;

    while (input[pos] == "#") {
      pos += 1;
      while (input[pos] && input[pos] != "\n") ++pos;
      while (iswhitespace()) ++pos;
    }

    return pos - start;
  }

  function read() {
    start = pos;
    if (pos >= input.length) {
      // end of input: must still update the token, or parse loops on the
      // last one forever
      peek = "eof";
      str = "";
      return;
    }
    let isdigit = () => "0" <= input.charAt(pos) && input.charAt(pos) <= "9";
    let isletter = () =>
      ("a" <= input.charAt(pos) && input.charAt(pos) <= "z") ||
      ("A" <= input.charAt(pos) && input.charAt(pos) <= "Z");
    let isopchar = () => optable.has(input.charAt(pos));

    start = pos;

    if (isdigit()) {
      while (isdigit()) pos++;
      peek = "num";
    } else if (isletter() || input.charAt(pos) === "_") {
      while (isletter() || isdigit() || input.charAt(pos) === "_") pos++;
      peek = "ident";
    } else if (input.charAt(pos) === "*") {
      // special case!
      while (input.charAt(pos) === "*") pos++;
      if (isletter() || isdigit() || input.charAt(pos) == "_") {
        while (isletter() || isdigit() || input.charAt(pos) == "_") pos++;
        peek = "ident";
      } else {
        while (isopchar()) pos++;
        peek = input.substring(start, pos);
      }
    } else if (input.charAt(pos) == "?") {
      // always a token on its own: it is only a postfix ('data.*A?'), and
      // may be followed by an operator, as in an optional field '{a?: u8}'
      pos++;
      peek = "?";
    } else if (isopchar()) {
      while (isopchar()) pos++;
      peek = input.substring(start, pos);
    } else if (input.charAt(pos) == '"') {
      // TODO: also support single quotes '..' ?
      pos++;
      while (
        input.charAt(pos) &&
        input.charAt(pos) != "\n" &&
        input.charAt(pos) != '"'
      )
        pos++;
      // note: unclosed string literals need to be detected later
      if (input.charAt(pos) == '"') pos++; // consume closing
      peek = "str";
    } else if (input.charAt(pos) === "\0") {
      pos += 1;
      hole += 1;
      peek = "hole";
    } else {
      peek = input.charAt(pos++);
    }
    str = input.substring(start, pos);
  }

  function next(): string {
    // if (gap > 0) seq.push(input.substring(strt-gap,strt))
    // if (peek != str && peek != '\n')
    //   seq.push(dom(peek, {start:strt,end:pos}, "", str))
    // else
    //   seq.push(str)
    let start = pos;
    let c = peek;
    let d = whitespace();
    gap = input.substring(start, pos);
    // console.log(d,"'"+gap+"'")
    read();
    return c;
  }

  // init lexer with first token to get going
  next();

  // Test the current token. Compare `peek` through this rather than with
  // `peek == t` directly: TS narrows `peek` on a direct comparison and keeps
  // that narrowing across next() / f() calls, which reassign it.
  const peekIs = (t: string): boolean => peek === t;

  // consume token t, or fail
  function expect(t: string) {
    if (!peekIs(t)) utils.error("'" + t + "' expected but got '" + peek + "'");
    next();
  }

  function delimited<T>(open: string, close: string, f: () => T): T {
    expect(open);
    const res = f();
    expect(close);
    return res;
  }

  const parens = <T>(f: () => T) => delimited("(", ")", f);
  const brackets = <T>(f: () => T) => delimited("[", "]", f);
  const braces = <T>(f: () => T) => delimited("{", "}", f);

  function commaList<T>(f: () => T): T[] {
    let res: T[] = [];
    if (peek == ")" || peek == "]" || peek == "}") return res;
    res.push(f());
    while (peek == ",") {
      next();
      res.push(f());
    }
    return res;
  }

  function expr(): Expr {
    if (peekIs("ident") && str == "let") {
      // 'let' ident+ '=' tight (';'|'\n') expr
      next();
      if (!peekIs("ident"))
        utils.error("ident expected but got '" + peek + "'");
      let lhs = str;
      next();

      let args = [];
      while (peekIs("ident")) {
        args.push(str);
        next();
      }
      // check unique?

      expect("=");
      let rhs = exprTight();
      // console.log(gap, "'"+gap+"'")
      if (!peekIs(";") && !gap.includes("\n"))
        utils.error("';' or newline expected but got '" + peek + "'");
      if (peekIs(";")) next();
      let body = expr();

      for (let x of args.reverse())
        // mutates!
        rhs = ast.call(ast.call(ast.ident("fn"), ast.ident(x)), rhs);

      let res = ast.call(ast.ident("let"), ast.ident(lhs));
      res = ast.call(res, rhs);
      res = ast.call(res, body);
      return res;
    } else {
      return binop(0);
    }
  }
  function exprTight(): Expr {
    return binopTight(50);
  }
  function binop(min: number): Expr {
    let res = loose();
    let op = binops[peek];
    while (op !== undefined && op.prec >= min) {
      let nextMin = op.prec + op.assoc; // + 1 for left assoc
      res = astBinop(next(), res, binop(nextMin));
      op = binops[peek];
    }
    return res;
  }
  function binopTight(min: number): Expr {
    let res = tight();
    let op = binops[peek];
    while (op !== undefined && op.prec >= min) {
      let nextMin = op.prec + op.assoc; // + 1 for left assoc
      res = astBinop(next(), res, binopTight(nextMin));
      op = binops[peek];
    }
    return res;
  }

  function atom(): Expr {
    if (peekIs("num") || peekIs("str") || peekIs("ident") || peekIs("*")) {
      let s = str;
      let res;
      if (peek == "num") {
        res = ast.constant(Number(s));
      } else if (peek == "str") {
        // strip quotes
        if (s.startsWith('"')) {
          s = s.substring(1, s.length);
          if (!s.endsWith('"')) utils.error("unclosed string literal");
          s = s.substring(0, s.length - 1);
        }
        res = ast.constant(s);
      } else if (s == "true" || s == "false") {
        res = ast.constant(s == "true");
      } else {
        res = ast.ident(s);
      }
      next();
      return res;
    } else if (peekIs("hole")) {
      let res = ast.hole(holes[hole]);
      next();
      return res;
    } else if (peekIs("(")) {
      return parens(expr);
    } else if (peekIs("{")) {
      // object constructor syntax
      let entry = (): [Expr, Expr] => {
        let key = expr();
        let val;
        if (peek == ":") {
          next();
          val = expr();
        } else {
          val = key;
        }
        return [key, val];
      };
      let elems = braces(() => commaList(entry));
      return ast.object(elems.flat());
    } else if (peekIs("[")) {
      // array constructor syntax
      let elems = brackets(() => commaList(expr));
      return ast.array(elems);
    } else if (peek == "@") {
      next();
      if (gap != "") {
        utils.error("no space allowed after '@'");
      }
      let res = atom();
      let schema = utils.todo("parse inline schema");
      return ast.hole(schema);
    } else {
      utils.error("atom expected but got '" + peek + "'");
    }
  }
  function tight() {
    let res;
    if (peekIs(".")) {
      // e.g. .input, to distinguish 'get' from 'ident'  TODO: require no space?
      next();
      let rhs = atom();
      res = ast.get(rhs);
    } else if (peekIs("num")) {
      // decimal literal? 0.123 ...
      let int = str;
      res = ast.constant(Number(int));
      next();
      if (peek == ".") {
        next();
        if (!peekIs("num"))
          utils.error("number expected but got '" + peek + "'");
        let frac = str;
        res = ast.constant(Number(int + "." + frac));
        next();
      }
    } else {
      res = atom();
    }

    if (gap == "" && peekIs("?")) {
      res = astPostop(next(), res);
    }

    while (gap == "" && (peekIs(".") || peekIs("(") || peekIs("["))) {
      if (peekIs(".")) {
        next();
        let rhs = atom();
        res = ast.get(res, rhs);
        if (gap == "" && peekIs("?")) {
          res = astPostop(next(), res);
        }
        // TODO: might want to prevent .{}. and .[]. which don't make sense
        // if (peek == "ident" || peek == "*") {
        //   let rhs = ast.ident(str)
        //   res = ast.get(res, rhs)
        //   next()
        // } else
        //   error("ident expected")
      } else if (peekIs("(")) {
        let rhs = parens(expr);
        res = ast.call(res, rhs);
      } else if (peekIs("[")) {
        let rhs = brackets(expr);
        res = ast.get(res, rhs);
      }
    }
    return res;
  }
  function loose() {
    let res = exprTight();
    while (
      peekIs("num") ||
      peekIs("str") ||
      peekIs("hole") ||
      peekIs("ident") ||
      peekIs("*") ||
      peekIs(".") ||
      peekIs("(") ||
      peekIs("[") ||
      peekIs("{") ||
      peekIs("@")
    ) {
      res = ast.call(res, exprTight());
    }
    return res;
  }

  // parser main entrypoint
  let res = expr();
  if (!peekIs("eof")) utils.error("couldn't parse '" + peek + "'");
  return res;
}
