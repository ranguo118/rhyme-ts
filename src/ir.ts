//
// ---------- simple-eval IR ----------
//
// Shape of the stratified IR produced by `preproc` (rhyme/src/preprocess.js)
// and transformed by the passes in rhyme/src/simple-eval.js.
//
// Fields of a term:
//
//  - key: node kind (discriminant)
//  - arg: subterms (ir passes process these recursively)
//  - op:  literal value if key = const, variable name if key = var,
//         op name for pure/stateful/prefix, file format for loadInput,
//         index for ref/genref
//  - mode: 'maybe' | 'reluctant' for stateful, 'reluctant' for prefix,
//          'maybe' for get and group, 'inplace' for update
//
// Unlike the original, preproc already normalizes the surface forms that
// extract0 used to handle, so there is a single IR from preproc onwards:
//
//  - get?             -> get, mode 'maybe'
//  - sum?, count? ... -> stateful sum/count/..., mode 'maybe'
//  - group?(k, e)     -> group(k, e), mode 'maybe'
//  - group(e)         -> group(placeholder, e)
//  - update_inplace   -> update, mode 'inplace'
//  - merge / keyval   -> only valid as an object value; spliced into the
//                        enclosing update as its key and value
//
// extract0 still does the semantic work (lowering group to update,
// canonicalizing *, inserting 'single', introducing mkset for non-variable
// group keys), so 'group' does not occur after extract0. Later passes
// annotate nodes in place (see `Annotations`) and extract2/extract3 replace
// subterms with 'ref' / 'genref'.
//

import type { PureOp, StatefulOp } from "./ops";

export type VarName = string;

export interface Input {
  key: "input";
}

export interface Const {
  key: "const";
  op: unknown; // any plain JS value; `false` is represented as `undefined`
}

export interface Var {
  key: "var";
  op: VarName; // starts with "*" in source, canonicalized to D<n> / K<n>
}

// group key standing for "all free variables of the value" (group(e))
export interface Placeholder {
  key: "placeholder";
  op: "*";
  arg: [];
}

export interface Get {
  key: "get";
  arg: [IR, IR];
  mode?: "maybe";
}

export interface Pure {
  key: "pure";
  op: PureOp;
  arg: IR[];
}

export interface Stateful {
  key: "stateful";
  op: StatefulOp;
  arg: [IR];
  mode?: "maybe" | "reluctant";
}

export interface Prefix {
  key: "prefix";
  op: StatefulOp;
  arg: IR[];
  mode?: "reluctant";
}

// group(k, e) / group?(k, e); group(e) gets a placeholder key.
// extract0 lowers it to update(base, k, e), with base {} for group and
// undefined for group? (not initialized if nothing builds it).
export interface Group {
  key: "group";
  arg: [key: IR, value: IR];
  mode?: "maybe";
}

export interface Update {
  key: "update";
  // base, key, value, optional generator filter for the key (extract0)
  arg: [IR, IR, IR] | [IR, IR, IR, IR];
  mode?: "inplace";
}

export interface Mkset {
  key: "mkset";
  arg: [IR];
}

export interface MkTuple {
  key: "mkTuple";
  arg: IR[]; // alternating key, value
}

export interface LoadInput {
  key: "loadInput";
  op: string; // file format; preproc currently only produces "json"
  arg: [IR]; // file name
  inputSchema: unknown;
}

// reference to assignments[op] (extract2)
export interface Ref {
  key: "ref";
  op: number;
  arg: [];
}

// reference to filters[op] (extract3, hard mode)
export interface Genref {
  key: "genref";
  op: number;
  arg: [];
}

// analysis results, filled in place by the passes in the order listed
export interface Annotations {
  // inferDims
  vars?: VarName[]; // variables used
  mind?: VarName[]; // minimum set of variables in output
  dims?: VarName[]; // desired set of variables in output
  // inferBound
  bnd?: VarName[]; // bound variables
  // inferFree
  fre?: VarName[]; // free variables
  ext?: VarName[]; // existentials: implied by fre/bnd but projected out
  extInit?: VarName[]; // existentials for init, disregarding bnd
  // extract2
  tmps?: number[]; // indices into assignments this term depends on
  // extract3
  filters?: number[]; // indices into filters this term depends on
  filter?: number; // this get is generator filters[filter] (soft mode)
  hint?: number; // this hint is hints[hint]
  // typing
  schema?: unknown;
}

export type IR = (
  | Input
  | Const
  | Var
  | Placeholder
  | Get
  | Pure
  | Stateful
  | Prefix
  | Group
  | Update
  | Mkset
  | MkTuple
  | LoadInput
  | Ref
  | Genref
) &
  Annotations;

export type IRKey = IR["key"];

// ----- state handed to the back end -----

export interface VarInfo {
  vars: VarName[]; // vars this var's generators depend on (transitive after computeDependencies)
  vars1: VarName[]; // direct dependencies only
}

export interface BackendIR {
  settings: Record<string, unknown>; // TODO: type once settings are ported
  prefixes: string[]; // JSON of canonicalized prefix expressions; index n names D<n> / K<n>
  path: VarName[]; // current grouping path variables
  vars: Record<VarName, VarInfo>;
  hints: IR[];
  filters: IR[]; // generators: get(e, var)
  assignments: IR[]; // extracted stateful / prefix / update terms
}
