import { expect, test } from "bun:test";
import { q, compile } from "../src/rhyme";
import { parse, rh } from "../src/parser";
import * as ast from "../src/ast";

test("a test", () => {
  let f = compile("1");
  console.log(f);
});

//
// Ported from rhyme/test/original/parser.test.js
//
// The original `parse` / `rh` also ran desugar, so its expectations include
// two desugar effects that are not ported yet. These tests check the parser
// output alone (the original `parserImpl`); once parse includes desugar:
//  - a leading path segment gets the input root: `a` -> get(raw inp, a)
//  - a hole holding an ast is replaced by it: hole(rh`b`) -> rh`b` ast
//

test("pathTest1", () => {
  let res = parse("a");
  let expected = ast.ident("a");
  expect(res._rhymeAst).toEqual(expected);
});

// test("pathTest2", () => {
//   let res = parse("a + b // comment")
//   let a = ast.ident("a")
//   let b = ast.ident("b")
//   let expected = ast.plus(a,b)
//   expect(res._rhymeAst).toEqual(expected)
// })

test("pathTest3", () => {
  let res = parse("a.*.*c");
  let a = ast.ident("a");
  let b = ast.ident("*");
  let c = ast.ident("*c");
  let expected = ast.get(ast.get(a, b), c); // desugar: get(get(get(root, a), b), c)
  expect(res._rhymeAst).toEqual(expected);
});

test("pathTest4", () => {
  let res = parse("(a)[b](c)");
  let a = ast.ident("a");
  let b = ast.ident("b");
  let c = ast.ident("c");
  let expected = ast.apply(ast.get(a, b), c); // desugar: apply(get(get(root, a), b), c)
  expect(res._rhymeAst).toEqual(expected);
});

test("templateTest1", () => {
  let res = rh`a.b.c`;
  let a = ast.ident("a");
  let b = ast.ident("b");
  let c = ast.ident("c");
  let expected = ast.get(ast.get(a, b), c); // desugar: get(get(get(root, a), b), c)
  expect(res._rhymeAst).toEqual(expected);
});

test("templateTest2", () => {
  let a = { foo: "bar" };
  let res = rh`${a}.b.c`;
  let b = ast.ident("b");
  let c = ast.ident("c");
  let expected = ast.get(ast.get(ast.hole(a), b), c);
  expect(res._rhymeAst).toEqual(expected);
});

test("templateTest3", () => {
  let a = { foo: "bar" };
  let b = rh`b`;
  // let res = rh`${a}.${b}.c` <-- this currently isn't allowed -- should it be?
  let res = rh`${a}[${b}].c`;
  let c = ast.ident("c");
  let expected = ast.get(ast.get(ast.hole(a), ast.hole(b)), c); // desugar: hole(b) -> b._rhymeAst
  expect(res._rhymeAst).toEqual(expected);
});

test("templateTest4", () => {
  let a = { foo: "bar" };
  let b = rh`b`;
  let res = rh`${a}.${b}.c`; // <-- this is now allowed
  let c = ast.ident("c");
  let expected = ast.get(ast.get(ast.hole(a), ast.hole(b)), c); // desugar: hole(b) -> b._rhymeAst
  expect(res._rhymeAst).toEqual(expected);
});

test("stringTest1", () => {
  let res = parse('"a"');
  let expected = ast.constant("a"); // test stripping of quotes
  expect(res._rhymeAst).toEqual(expected);
});

test("arrayTest0", () => {
  let res = parse("[]");
  let expected = ast.array([]);
  expect(res._rhymeAst).toEqual(expected);
});

test("arrayTest1", () => {
  let res = parse("[a,b,c]");
  let expected = ast.array([ast.ident("a"), ast.ident("b"), ast.ident("c")]);
  expect(res._rhymeAst).toEqual(expected);
});

test("objectTest0", () => {
  let res = parse("{}");
  let expected = ast.object([]);
  expect(res._rhymeAst).toEqual(expected);
});

test("objectTest1", () => {
  let res = parse("{a,b,c}");
  let expected = ast.object([
    ast.ident("a"),
    ast.ident("a"),
    ast.ident("b"),
    ast.ident("b"),
    ast.ident("c"),
    ast.ident("c"),
  ]);
  expect(res._rhymeAst).toEqual(expected);
});

test("objectTest2", () => {
  let res = parse("{a:a1,b:b1,c:c1}");
  let expected = ast.object([
    ast.ident("a"),
    ast.ident("a1"),
    ast.ident("b"),
    ast.ident("b1"),
    ast.ident("c"),
    ast.ident("c1"),
  ]);
  expect(res._rhymeAst).toEqual(expected);
});
