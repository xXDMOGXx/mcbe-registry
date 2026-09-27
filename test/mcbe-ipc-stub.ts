/**
 * Vitest stub for `mcbe-ipc` so tests never load Omniac's module (it imports
 * `@minecraft/server` from a nested path Vite cannot alias).
 */
const token = {};

function passThrough(): unknown {
  return token;
}

/** Minimal PROTO tokens used by schema-3 wire types. */
export const PROTO = {
  Int32: token,
  VarInt32: token,
  UVarInt32: token,
  Float64: token,
  String: token,
  Boolean: token,
  Optional: passThrough,
  Array: passThrough,
  Map: passThrough,
  Object: passThrough,
};

const ipc = {
  invoke() {
    return Promise.reject(new Error("mcbe-ipc stub: invoke not wired"));
  },
  handle() {
    return () => undefined;
  },
  send() {
    return undefined;
  },
  on() {
    return () => undefined;
  },
};

export default ipc;
