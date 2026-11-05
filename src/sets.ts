//
// ---------- sets, implemented as arrays ----------
//
// Ported from rhyme/src/shared.js (`sets`). Results keep the order of the
// inputs (first occurrence wins), which the analysis passes rely on, e.g.
// for the order of variables and generated loops.
//
// Membership uses a Set instead of the original plain-object lookup table,
// which also matched inherited names such as "toString" or "constructor".
//

// duplicates removed, first occurrence kept
export const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

// elements of a, then those of b not in a
export const union = <T>(a: readonly T[], b: readonly T[]): T[] =>
  unique([...a, ...b]);

// elements of a that are in b, in a's order (duplicates in a are kept)
export const intersect = <T>(a: readonly T[], b: readonly T[]): T[] => {
  const keys = new Set(b);
  return a.filter((k) => keys.has(k));
};

// elements of a that are not in b, in a's order (duplicates in a are kept)
export const diff = <T>(a: readonly T[], b: readonly T[]): T[] => {
  const keys = new Set(b);
  return a.filter((k) => !keys.has(k));
};

// every element of a is in b
export const subset = <T>(a: readonly T[], b: readonly T[]): boolean => {
  const keys = new Set(b);
  return a.every((k) => keys.has(k));
};

// same elements, ignoring order and duplicates
export const same = <T>(a: readonly T[], b: readonly T[]): boolean =>
  subset(a, b) && subset(b, a);
