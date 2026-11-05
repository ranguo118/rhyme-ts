import { expect, test } from "bun:test";
import { rh, compile } from "../src/rhyme";
import { desugar } from "../src/desugar";
import * as ast from "../src/ast";

//
// Ported from rhyme/test/original/desugar.test.js
//
// Each original test checks that several spellings desugar to the same tree,
// that desugar is idempotent, and then runs the query via compileCrossCheck.
// The execution checks are split into "<name> (exec)" todo tests, using
// compile in place of compileCrossCheck: flip test.todo -> test once compile
// produces results.
//

test("pipeTest1", () => {
  let q0 = rh`input.foo`;
  let q1 = rh`input | .foo`;
  let q2 = rh`.input | .foo`;
  let q3 = rh`.input | get(foo)`;
  let q4 = rh`.input | get foo`;

  expect(q1).toEqual(q0);
  expect(q2).toEqual(q0);
  expect(q3).toEqual(q0);
  expect(q4).toEqual(q0);

  // sanity: desugar is idempotent
  // (the original desugared q2 for q3d and q4d, presumably a copy-paste slip)
  let q0d = desugar(q0._rhymeAst);
  let q1d = desugar(q1._rhymeAst);
  let q2d = desugar(q2._rhymeAst);
  let q3d = desugar(q3._rhymeAst);
  let q4d = desugar(q4._rhymeAst);

  expect(q0d).toEqual(q0._rhymeAst);
  expect(q1d).toEqual(q1._rhymeAst);
  expect(q2d).toEqual(q2._rhymeAst);
  expect(q3d).toEqual(q3._rhymeAst);
  expect(q4d).toEqual(q4._rhymeAst);
});

test.todo("pipeTest1 (exec)", () => {
  let input = { foo: { bar: { baz: { boom: 7 } } } };
  let func = compile(rh`input.foo`, {});
  let res = func({ input });
  expect(res).toBe(input.foo);
});

test("pipeTest2", () => {
  let q0 = rh`input.foo.bar.baz.boom`;
  let q1 = rh`.input | .foo.bar | .baz.boom`;
  let q2 = rh`.input | get(foo) | .bar | get(baz) | .boom`;
  let q3 = rh`.input | get foo  | .bar | get baz  | .boom`;

  expect(q1).toEqual(q0);
  expect(q2).toEqual(q0);
  expect(q3).toEqual(q0);

  let q0d = desugar(q0._rhymeAst);
  let q1d = desugar(q1._rhymeAst);
  let q2d = desugar(q2._rhymeAst);
  let q3d = desugar(q3._rhymeAst);

  expect(q0d).toEqual(q0._rhymeAst);
  expect(q1d).toEqual(q1._rhymeAst);
  expect(q2d).toEqual(q2._rhymeAst);
  expect(q3d).toEqual(q3._rhymeAst);
});

test.todo("pipeTest2 (exec)", () => {
  let input = { foo: { bar: { baz: { boom: 7 } } } };
  let func = compile(rh`input.foo.bar.baz.boom`, {});
  let res = func({ input });
  expect(res).toBe(7);
});

test("pipeTest3", () => {
  let q0 = rh`sum(input.foo)`;
  let q1 = rh`input | .foo | sum`;
  let q2 = rh`input | sum(.foo)`;
  let q3 = rh`input | (.foo | sum)`;

  let q4 = rh`input | sum .foo`;
  let q5 = rh`input | (get foo | sum)`;
  let q6 = rh`(input | get foo) | sum`;
  let q7 = rh`sum input.foo`;

  expect(q1).toEqual(q0);
  expect(q2).toEqual(q0);
  expect(q3).toEqual(q0);
  expect(q4).toEqual(q0);
  expect(q5).toEqual(q0);
  expect(q6).toEqual(q0);
  expect(q7).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);
  let q2d = desugar(q2._rhymeAst);
  let q3d = desugar(q3._rhymeAst);
  let q4d = desugar(q4._rhymeAst);
  let q5d = desugar(q5._rhymeAst);
  let q6d = desugar(q6._rhymeAst);
  let q7d = desugar(q7._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
  expect(q2d).toEqual(q2._rhymeAst);
  expect(q3d).toEqual(q3._rhymeAst);
  expect(q4d).toEqual(q4._rhymeAst);
  expect(q5d).toEqual(q5._rhymeAst);
  expect(q6d).toEqual(q6._rhymeAst);
  expect(q7d).toEqual(q7._rhymeAst);
});

test.todo("pipeTest3 (exec)", () => {
  let input = { foo: 7 };
  let func = compile(rh`sum(input.foo)`, {});
  let res = func({ input });
  expect(res).toBe(7);
});

test("callTest1", () => {
  let q0 = rh`a(b)(c)(d)`;
  let q1 = rh`a b c d`;

  let e = ast.op("apply", [
    ast.ident("a"),
    ast.ident("b"),
    ast.ident("c"),
    ast.ident("d"),
  ]);

  expect(q1._rhymeAst).toEqual(e);

  expect(q1).toEqual(q0);

  let q0d = desugar(q0._rhymeAst);
  let q1d = desugar(q1._rhymeAst);

  expect(q0d).toEqual(q0._rhymeAst);
  expect(q1d).toEqual(q1._rhymeAst);
});

test("letTest1", () => {
  let q0 = rh`7`;
  let q1 = rh`let x = 7; x`;

  expect(q1).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
});

test.todo("letTest1 (exec)", () => {
  let func = compile(rh`let x = 7; x`, {});
  let res = func({});
  expect(res).toBe(7);
});

test("letTest2", () => {
  let q0 = rh`input.foo`;
  let q1 = rh`let x = input; x.foo`;

  expect(q1).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
});

test.todo("letTest2 (exec)", () => {
  let input = { foo: 7 };
  let func = compile(rh`let x = input; x.foo`, {});
  let res = func({ input });
  expect(res).toBe(7);
});

test("lambdaTest1", () => {
  let q0 = rh`input.foo`;

  let q1 = rh`(fn x x.foo) input`;
  let q2 = rh`input | fn x x.foo`;

  let q3 = rh`.foo input`;
  let q4 = rh`input | .foo`;

  expect(q1).toEqual(q0);
  expect(q2).toEqual(q0);
  expect(q3).toEqual(q0);
  expect(q4).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);
  let q2d = desugar(q2._rhymeAst);
  let q3d = desugar(q3._rhymeAst);
  let q4d = desugar(q4._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
  expect(q2d).toEqual(q2._rhymeAst);
  expect(q3d).toEqual(q3._rhymeAst);
  expect(q4d).toEqual(q4._rhymeAst);
});

test.todo("lambdaTest1 (exec)", () => {
  let input = { foo: 7 };
  let func = compile(rh`(fn x x.foo) input`, {});
  let res = func({ input });
  expect(res).toBe(7);
});

test("lambdaTest2", () => {
  let q0 = rh`3 + 4`;
  let q1 = rh`(fn x (fn y x+y)) 3 4`;

  expect(q1).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
});

test.todo("lambdaTest2 (exec)", () => {
  let input = { foo: 7 };
  let func = compile(rh`(fn x (fn y x+y)) 3 4`, {});
  let res = func({ input });
  expect(res).toBe(7);
});

// The following test cases for
// array and object syntax won't
// produce identical parse trees
// after desugaring.
//
// We test semantic equivalence
// instead.
//
// (The original compared func1's result with itself; this compares the
// plain-value query with the rh`` one, as intended, and also checks the
// result, since two broken queries would otherwise compare equal.)

test.todo("arrayTest0", () => {
  let input = {};

  let q1 = [];
  let q2 = rh`[]`;

  let func1 = compile(q1, {});
  let func2 = compile(q2, {});
  let res1 = func1({ input });
  let res2 = func2({ input });
  expect(res1).toEqual(q1); // a plain-value query evaluates to itself
  expect(res2).toEqual(res1);
});

test.todo("arrayTest1", () => {
  let input = {};

  let q1 = [1, 2, 3];
  let q2 = rh`[1, 2, 3]`;

  let func1 = compile(q1, {});
  let func2 = compile(q2, {});
  let res1 = func1({ input });
  let res2 = func2({ input });
  expect(res1).toEqual(q1); // a plain-value query evaluates to itself
  expect(res2).toEqual(res1);
});

test.todo("objectTest0", () => {
  let input = {};

  let q1 = {};
  let q2 = rh`{}`;

  let func1 = compile(q1, {});
  let func2 = compile(q2, {});
  let res1 = func1({ input });
  let res2 = func2({ input });
  expect(res1).toEqual(q1); // a plain-value query evaluates to itself
  expect(res2).toEqual(res1);
});

test.todo("objectTest1", () => {
  let input = {};

  let q1 = { a: 1, b: 2, c: 3 };
  let q2 = rh`{a:1, b:2, c:3}`;

  let func1 = compile(q1, {});
  let func2 = compile(q2, {});
  let res1 = func1({ input });
  let res2 = func2({ input });
  expect(res1).toEqual(q1); // a plain-value query evaluates to itself
  expect(res2).toEqual(res1);
});

test("letTest3", () => {
  let q0 = rh`{all: [1,2,3]}`;
  let q1 = rh`let x = [1,2,3]
              {all: x}`;

  expect(q1).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
});

test.todo("letTest3 (exec)", () => {
  let input = { foo: 7 };
  let func = compile(rh`{all: [1,2,3]}`, {});
  let res = func({ input });
  expect(res).toEqual({ all: [1, 2, 3] });
});

test("letTest4", () => {
  let q0 = rh`{all: [1,2,3]}`;
  let q1 = rh`let f x y z = [x,y,z]
              {all: f 1 2 3}`;

  expect(q1).toEqual(q0);

  let q1d = desugar(q1._rhymeAst);

  expect(q1d).toEqual(q1._rhymeAst);
});

test.todo("letTest4 (exec)", () => {
  let input = { foo: 7 };
  let func = compile(rh`{all: [1,2,3]}`, {});
  let res = func({ input });
  expect(res).toEqual({ all: [1, 2, 3] });
});
