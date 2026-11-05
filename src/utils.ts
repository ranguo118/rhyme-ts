const debug = true;

export function log(...data: any[]) {
  if (debug) console.error(...data);
}

export function todo(s: string): never {
  throw new Error("TODO: " + s);
}

export function error(s: string): never {
  throw new Error(s);
}
