//
// ---------- surface operations ----------
//
// The ops that can appear in the AST (ast.ts `OpKey`) and in surface text,
// i.e. the query API vocabulary. This is NOT the op set of the IR: preproc
// maps these onto IR nodes (ir.ts), and the IR owns its own op names.
//
//  - special:  each becomes its own top-level IR node (get, update, ...)
//  - pure:     IR `pure` node, op name carried over
//  - stateful: IR `stateful` / `prefix` node; the "?" and "prefix_"
//              variants exist only here and become a mode / node kind
//
// Ported from rhyme/src/shared.js, where each registry was an object mapping
// op name -> true. Here each is a Set: use `ops.<kind>.has(op)` / `for..of`.
//

// special operations, each becomes its own top-level IR node

export const specialOps = [
  "loadJSON",
  "get",
  "group",
  "update",
  "update_inplace",
  "merge",
  "keyval",
] as const;

export const specialOpsFull = [...specialOps, "get?", "group?"] as const;

// pure operations

export const pureOps = [
  "apply",
  "pipe",
  "plus",
  "concat",
  "minus",
  "times",
  "fdiv",
  "div",
  "mod",
  "and",

  "andAlso",
  "orElse",

  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "join",
  "singleton",
  "vars",
  "ifElse",

  "year",
  "hour",

  "length",
  "sort",
  "like",
  "substr",
  "isUndef",

  "dot",
  "flatten",
] as const;

// stateful operations

const statefulOps = [
  "sum",
  "product",
  "count",
  "max",
  "min",
  "array",
  "object",
  "mkset",

  "first",
  "last",
  "single",
  "all",
  "any",
] as const;

// every stateful op also has a "?" variant ("group?" is handled as special)
const statefulOpsMaybe = [
  ...statefulOps,
  ...statefulOps.map((op) => `${op}?` as const),
];

// ... and a "prefix_" variant of each of those
export const statefulOpsFull = [
  ...statefulOpsMaybe,
  ...statefulOpsMaybe.map((op) => `prefix_${op}` as const),
] as const;

export type StatefulOp = (typeof statefulOps)[number];

export type SpecialOp = (typeof specialOps)[number];
export type SpecialOpFull = (typeof specialOpsFull)[number];
export type PureOp = (typeof pureOps)[number];
export type StatefulOpFull = (typeof statefulOpsFull)[number];
export type Op = SpecialOpFull | PureOp | StatefulOpFull;

export const ops = {
  special: new Set<string>(specialOps),
  specialFull: new Set<string>(specialOpsFull),
  pure: new Set<string>(pureOps),
  stateful: new Set<string>(statefulOps),
  statefulFull: new Set<string>(statefulOpsFull),
};

export const isSpecialOp = (op: string): op is SpecialOp => ops.special.has(op);
export const isSpecialOpFull = (op: string): op is SpecialOpFull =>
  ops.specialFull.has(op);
export const isPureOp = (op: string): op is PureOp => ops.pure.has(op);
export const isStatefulOp = (op: string): op is StatefulOp =>
  ops.stateful.has(op);
export const isStatefulOpFull = (op: string): op is StatefulOpFull =>
  ops.statefulFull.has(op);
