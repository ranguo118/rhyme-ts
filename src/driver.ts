import * as ast from "./ast";
import * as utils from "./utils";
import type { IR, VarName } from "./ir";
import { preprocess } from "./preprocess";
import { unique, union, subset, diff, intersect } from "./sets";

const intersects = <T>(a: readonly T[], b: readonly T[]) =>
  intersect(a, b).length > 0;

// ----- configuration space -----

// Ported from simple-eval.js defaultSettings as the passes that read them
// are ported.
const defaultSettings: Record<string, any> = {
  // frontend -- preprocess.ts
  //
  // Off by default: an all-constant-key record then desugars to a chain of
  // stateful updates rather than a single pure node.
  mkTuple: false,

  // analysis and extraction
  // extractGroupKeys: false,

  // backend selection
  backend: "js",
};

// ----- auxiliary state -----

let settings: Record<string, any> = defaultSettings;

// canonicalize * for every prefix, e.g., data.* (preproc): the JSON of each
// distinct prefix expression, its index n names the variable D<n> / K<n>
let prefixes = new Map<string, number>();
// let path          // current grouping path variables (extract)

let vars: Record<VarName, { vars: VarName[]; vars1: VarName[] }> = {}; // deps var->var, var->tmp
// let hints
// let filters
// let assignments

let reset = (userSettings: Record<string, any>) => {
  settings = { ...defaultSettings, ...userSettings };

  // The original C backend (cgen.generateC, shared by "c" and "cuda") has no
  // rt_pure_mkTuple and builds record literals from the pure node directly, so
  // it needs mkTuple even though the default is off. An explicit setting still
  // wins -- this only supplies a different default.
  // if (userSettings?.mkTuple === undefined &&
  //     (settings.backend == "c" || settings.backend == "cuda"))
  //   settings.mkTuple = true

  prefixes = new Map();
  // path = []

  vars = {};
  // hints = []
  // filters = []
  // assignments = []
};

// same prefix -> same variable, distinct prefixes -> distinct variables.
// D and K variables share the index space.
let canonicalVarName = (e1: IR, isCorrelatedGroupKey: boolean): VarName => {
  const str = JSON.stringify(e1);
  let key = prefixes.get(str);
  if (key === undefined) {
    key = prefixes.size; // next fresh id, assigned once
    prefixes.set(str, key);
  }
  return (isCorrelatedGroupKey ? "K" : "D") + key;
};

// ----- front end -----

//
// 1. Preprocess: convert from Rhyme AST to our slightly stratified version
//    (preprocess.ts)
//
// We currently support: input, const, var, get, plus, times, sum, group
//

//
// 2,4,7,8. Extract: extract key information from program
//  into external data structures
//

// 2: extract0:
// - canonicalize *
// - insert 'single' in nested stateful positions
// - lower group to update
// - ensure all grouping is wrt a variable, i.e.,
//   transform { e1: e2 } to {}{ K1: e2 } / mkset(e1).K1
//
// (the original also did: transform 'get?', 'sum?', etc to 'get', 'sum'
// with mode 'maybe', and recognize other modes, e.g. 'update_inplace';
// preproc already does that)
//

// an update value: anything that is not itself collective is wrapped in a
// reluctant 'single'
let extractFlex0 = (q: IR): IR => {
  switch (q.key) {
    case "mkTuple":
      // return { key:"stateful", op: "single", mode: "reluctant", arg:[{ ...q, arg: q.arg.map(extractFlex0) }] }
      return {
        ...q,
        arg: q.arg.map((e, i) => (i % 2 == 0 ? extract0(e) : extractFlex0(e))),
      };
    case "stateful":
    case "group":
    case "update": // prefix?
      return extract0(q);
    default:
      return extract0({
        key: "stateful",
        op: "single",
        mode: "reluctant",
        arg: [q],
      });
  }
};

// an update key
let extractKey0 = (q: IR): IR => {
  if (q.key == "var" && q.op == "*WILDCARD") {
    // XXX
    return { key: "placeholder", op: "*", arg: [] };
  }
  return extract0(q); // could move more logic here
};

// update(e0, k, v), from an update or a lowered group
let extractUpdate = (e0: IR, k: IR, v: IR, mode: "inplace" | undefined): IR => {
  e0 = extract0(e0);
  const e1 = extractKey0(k);
  const e2 = extractFlex0(v);
  const m = mode === undefined ? {} : { mode };
  if (
    e1.key == "var" ||
    e1.key == "placeholder" ||
    (e1.key == "pure" && e1.op == "vars")
  )
    return { key: "update", arg: [e0, e1, e2], ...m };

  // key is not a variable: group by K1 ranging over mkset(e1).
  // v1 and v2 name the same variable but are separate nodes, since later
  // passes annotate nodes in place.
  const prefix: IR = { key: "mkset", arg: [e1] };
  const v1: IR = { key: "var", op: canonicalVarName(prefix, true) };
  const v2: IR = { key: "var", op: canonicalVarName(prefix, true) };

  if (settings.backend != "js" || !settings.extractGroupKeys)
    return {
      key: "update",
      arg: [e0, v1, e2, { key: "get", arg: [prefix, v2] }],
      ...m,
    };

  // desugar update(e1,e2) as:
  //   count(mkset(e1).K1) & update(K1, e2)

  const p: IR = {
    key: "stateful",
    op: "count",
    arg: [{ key: "get", arg: [prefix, v2] }],
  };

  return {
    key: "pure",
    op: "and",
    arg: [p, { key: "update", arg: [e0, v1, e2], ...m }],
  };

  // return { ...q, arg: [v1,
  //   { key:"stateful", op: "single", mode: "reluctant", arg:[
  //     { key: "pure", op: "and", arg:[
  //       { key: "get", arg: [prefix, v2] }, e2]}]} ]}
};

function extract0(q: IR): IR {
  switch (q.key) {
    case "var":
      if (q.op == "*") utils.error("cannot support free-standing *");
      return q;
    case "get": {
      let [e1, e2] = q.arg;
      // canonicalize '*' in 'data.*' to a unique variable
      // NOTE: we use e1 _before_ extract as key -- XXX consistent with 'update' below?
      if (e2.key == "var" && e2.op == "*")
        e2 = { ...e2, op: canonicalVarName(e1, false) };
      return { ...q, arg: [extract0(e1), extract0(e2)] };
    }
    case "group": {
      // group builds into {}; group? into undefined, i.e. "not initialized
      // if nothing builds it"
      const [k, v] = q.arg;
      const base: IR = { key: "const", op: q.mode == "maybe" ? undefined : {} };
      return extractUpdate(base, k, v, undefined);
    }
    case "update": {
      // a 4th arg (the key generator) is only added here, by extractUpdate
      const [e0, k, v] = q.arg;
      return extractUpdate(e0, k, v, q.mode);
    }
    case "stateful":
    case "prefix":
    case "mkset":
    case "loadInput":
      return { ...q, arg: [extract0(q.arg[0])] };
    case "pure":
    case "mkTuple":
      return { ...q, arg: q.arg.map((e) => extract0(e)) };
    case "input":
    case "const":
    case "placeholder":
    case "ref":
    case "genref":
      return q;
    default: {
      const unhandled: never = q;
      utils.error("unhandled IR node " + JSON.stringify(unhandled));
    }
  }
}

// 5: extract var -> filter variable deps
//    - runs after inferBound()
//    - in a fixpoint loop, hence checking convergence

let varsChanged = false;

function extract1(q: IR) {
  if ("arg" in q) q.arg.forEach(extract1);
  if (q.key == "var") {
    vars[q.op] ??= { vars: [], vars1: [] };
  } else if (q.key == "get") {
    const [e1, e2] = q.arg;
    if (e2.key == "var") {
      const e2Vars = (vars[e2.op] ??= { vars: [], vars1: [] });
      const deps = e1.fre ?? e1.dims!; // fre once inferFree has run, dims before
      if (!subset(deps, e2Vars.vars)) {
        varsChanged = true;
        e2Vars.vars = union(e2Vars.vars, deps);
        e2Vars.vars1 = union(e2Vars.vars1, deps);
      }
    }
  }
}

// ----- middle-tier -----

//
// 3. Infer dependencies bottom up:
//    - vars: variables used
//    - mind: minimum set of variables in output (not removed through reductions)
//    - dims: desired set of variables in output
//

function inferDims(q: IR): IR {
  if (q.key == "input" || q.key == "const" || q.key == "placeholder") {
    q.vars = [];
    q.mind = [];
    q.dims = [];
  } else if (q.key == "var") {
    q.vars = [q.op];
    q.mind = [q.op];
    q.dims = [q.op];
  } else if (
    q.key == "get" ||
    q.key == "pure" ||
    q.key == "mkTuple" ||
    q.key == "mkset" ||
    q.key == "loadInput"
  ) {
    const es = q.arg.map(inferDims);
    q.vars = unique(es.flatMap((x) => x.vars ?? []));
    q.mind = unique(es.flatMap((x) => x.mind ?? []));
    q.dims = unique(es.flatMap((x) => x.dims ?? []));
    // special case for 'get': nudge reluctant prefix to aggregate
    if (q.key == "get") {
      const [e0, e1] = q.arg;
      q.dims = union(e0.mind ?? [], e1.dims ?? []);
    }
  } else if (q.key == "stateful" || q.key == "prefix") {
    const e1 = inferDims(q.arg[0]);

    // NOTE: wo do not include vars/tmps/dims information from path,
    // only from e1. What is the rationale for this?

    // In short: we want to decorrelate paths but we don't have enough
    // information yet. Specifically, transitive var dependencies are
    // only available after inferDims.

    q.vars = e1.vars ?? [];
    q.mind = []; // can always reduce to one elem
    if (q.mode == "reluctant") {
      q.dims = e1.dims ?? []; // but prefer not to
    } else {
      q.dims = [];
    }
  } else if (q.key == "update") {
    const e0 = inferDims(q.arg[0]);
    const e1 = inferDims(q.arg[1]);
    const e2 = inferDims(q.arg[2]);
    let e3: IR | { vars: VarName[]; mind: VarName[]; dims: VarName[] } =
      q.arg[3] !== undefined
        ? inferDims(q.arg[3])
        : { vars: [], mind: [], dims: [] };
    q.vars = unique([
      ...(e0.vars ?? []),
      ...(e1.vars ?? []),
      ...(e2.vars ?? []),
      ...(e3.vars ?? []),
    ]);
    // treat e3 like a reduction: do not propagate it's inner mind/dims
    if (e1.key == "placeholder") {
      q.mind = [];
      q.dims = e0.dims;
    } else {
      q.mind = union(e0.mind ?? [], diff(e2.mind ?? [], e1.vars ?? []));
      q.dims = union(e0.dims ?? [], diff(e2.dims ?? [], e1.vars ?? []));
    }
  } else {
    utils.error("unknown IR node " + JSON.stringify(q));
  }
  console.assert(subset(q.mind ?? [], q.dims ?? []));
  console.assert(subset(q.dims ?? [], q.vars ?? []));
  return q;
}

//
// 4. Infer dependencies top down:
//    - out:  maximum allowed set of variables in output (provided as input arg)
//    - free: free variables, anticipating conversion to loops
//    - bound: bound variables, anticipating conversion to loops (allBound: incl deep in subterms)
//    - (iter: iteration space for stms (= free + bound))
//
//    Decorrelate paths and eliminate trivial recursion
//

// infer bound vars (simple mode)
const inferBound =
  (out: VarName[]) =>
  (q: IR): IR => {
    if (q.key == "input" || q.key == "const" || q.key == "placeholder") {
      q.bnd = [];
    } else if (q.key == "var") {
      q.bnd = [];
    } else if (
      q.key == "get" ||
      q.key == "pure" ||
      q.key == "mkTuple" ||
      q.key == "mkset" ||
      q.key == "loadInput"
    ) {
      const es = q.arg.map(inferBound(out));
      q.bnd = [];
    } else if (q.key == "stateful" || q.key == "prefix") {
      const out1 = union(out, q.arg[0].dims!); // need to consider mode?
      const e1 = inferBound(out1)(q.arg[0]);
      q.bnd = diff(e1.dims!, out);
    } else if (q.key == "update") {
      let e0 = inferBound(out)(q.arg[0]); // what are we extending
      let e1 = inferBound(out)(q.arg[1]); // key variable

      if (e1.key == "placeholder") {
        let bnd = diff(q.arg[2].dims!, out);
        e1 = q.arg[1] = {
          key: "pure",
          op: "vars",
          arg: bnd.map((x) => ({
            key: "var",
            op: x,
            arg: [],
            vars: [x],
            mind: [x],
            dims: [x],
            bnd: [],
          })),
          vars: bnd,
          mind: bnd,
          dims: bnd,
          bnd: [],
        };
      }

      if (q.arg[3] !== undefined) {
        let out3 = union(out, q.arg[3].dims!);
        let e3 = inferBound(out3)(q.arg[3]); // filter expr
        console.assert(
          e3.key === "get" &&
            e3.arg[0].key == "mkset" &&
            e3.arg[1].key == "var" &&
            e1.key == "var" &&
            e3.arg[1].op == e1.op,
        );
        // let e1Body = e3.arg[0].arg[0]
      }

      let e2 = inferBound(union(out, e1.vars!))(q.arg[2]);

      q.bnd = diff(e1.vars!, out);
    } else {
      utils.error("unknown IR node " + JSON.stringify(q));
    }
    console.assert(subset(q.mind!, q.dims!));
    console.assert(subset(q.dims!, q.vars!));

    console.assert(!intersects(q.bnd, out));

    return q;
  };

//
// 6: Compute dependencies between vars
//    - fill in vars[i].vars, which has been
//      initialized to q.dims of filter
//      expressions by extract1
//
//    This runs between infer and inferBwd
//
//    NOTE: codegen recomputes dependencies
//    based on q.fre of filter expressions
//
//    vars[i].vars becomes every var reachable from i (vars1 keeps the
//    direct ones), in the order they are first reached.
//

function computeDependencies() {
  // calculate transitive dependencies between vars directly

  const depsOf = (v: VarName): readonly VarName[] => {
    const info = vars[v];
    if (info === undefined) utils.error("no var info for " + v);
    return info.vars;
  };

  // var -> vars reachable from it. Computed for all vars before any
  // vars[i].vars is overwritten, since the search reads them.
  const var2var = new Map<VarName, Set<VarName>>();

  const followVarVar = (reached: Set<VarName>, j: VarName) => {
    if (reached.has(j)) return;
    reached.add(j);
    for (const k of depsOf(j)) followVarVar(reached, k);
  };

  for (const i of Object.keys(vars)) {
    const reached = new Set<VarName>();
    for (const j of depsOf(i)) followVarVar(reached, j);
    var2var.set(i, reached);
  }

  // inject transitive closure info so "inferBwd" will pick it up
  for (const [i, reached] of var2var) {
    const info = vars[i];
    if (info !== undefined) info.vars = [...reached];
  }
}

export function compile(input: unknown, userSettings: Record<string, any>) {
  const e = ast.unwrap(input);

  reset(userSettings);

  // ---- front end ----
  // 1. Preprocess (after parse, desugar)
  let q = preprocess(e, settings);
  // rh`sum (x)` -> {op: "sum", arg: [x], deps: fre: [], bnd: []}.
  // rh`update a k v` -> {op: "update", arg: [a, k, v]}

  const src = q;

  // 2. Extract
  q = extract0(q); // basic massaging

  // ---- middle tier ----

  // 3. Infer dependencies bottom up
  q = inferDims(q);

  // 4. Backward pass to infer output dimensions
  // (the original: settings.singleResult ? q.mind : q.dims, with
  // singleResult on by default)
  const out = q.mind ?? [];
  q = inferBound(out)(q);

  // Fixpoint loop:

  // 5. Extract var->var dependencies due to filters

  // 6. Calculate transitive var->var dependencies

  // 7. Infer free variables of term

  // TODO: inferFree, then loop until extract1 reports no change
  varsChanged = false;
  extract1(q);
  computeDependencies();

  utils.log(JSON.stringify(q), vars);

  function wrapper(inp: any) {
    return undefined;
  }
  wrapper.explain = {};

  return wrapper;
}
