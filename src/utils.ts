const debug = false;

export function log(s: string) {
  if (debug) console.error(s);
}

export function todo(s: string): never {
  throw new Error("TODO: " + s);
}

export function error(s: string): never {
  throw new Error(s);
}
