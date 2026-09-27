import { canonicalizeRecipes } from "@mcbe-reciperegistry/client";
import { type Recipe } from "./protocol.js";

/** World dynamic-property key prefix for one registering pack's recipe blobs. */
export const SOURCE_KEY_PREFIX = "reciperegistry:src:";

/** Character budget per blob, below Bedrock's 32,767-char property cap. */
export const DP_CHUNK_LIMIT = 24000;

/** Ticks after `ready` before unsynced persisted sources are dropped (60s at 20 TPS). */
export const SYNC_GRACE_TICKS = 1200;

/** Persist meta format version (`fp` field). */
const META_V = 2;

/** Namespace-like pack id used as a persist key (`demo`, `digitalstorage`). */
const SOURCE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** Structural slice of `world` used to read/write recipe blobs. */
export interface DynamicPropertyStore {
  getDynamicProperty(id: string): unknown;
  setDynamicProperty(id: string, value: string | number | boolean | undefined): void;
  getDynamicPropertyIds(): string[];
}

/** One persisted registering pack loaded from world dynamic properties. */
export interface PersistedSource {
  source: string;
  fp: string;
  recipes: Recipe[];
}

/** True when `source` is a legal persist key. */
export function isValidSource(source: string): boolean {
  return SOURCE_PATTERN.test(source);
}

/** Meta dynamic-property key for `source`. */
export function sourceMetaKey(source: string): string {
  return `${SOURCE_KEY_PREFIX}${source}:meta`;
}

/** Chunk dynamic-property key for `source` at `index`. */
export function sourceChunkKey(source: string, index: number): string {
  return `${SOURCE_KEY_PREFIX}${source}:${index}`;
}

/** Slices `json` into blobs of at most `limit` characters. */
export function splitBlob(json: string, limit = DP_CHUNK_LIMIT): string[] {
  if (json.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += limit) chunks.push(json.slice(i, i + limit));
  return chunks;
}

function parseSourceKey(key: string): { source: string; kind: "meta" | number } | undefined {
  if (!key.startsWith(SOURCE_KEY_PREFIX)) return undefined;
  const rest = key.slice(SOURCE_KEY_PREFIX.length);
  const colon = rest.lastIndexOf(":");
  if (colon < 1) return undefined;
  const source = rest.slice(0, colon);
  const tail = rest.slice(colon + 1);
  if (!isValidSource(source)) return undefined;
  if (tail === "meta") return { source, kind: "meta" };
  if (/^\d+$/.test(tail)) return { source, kind: Number(tail) };
  return undefined;
}

function parseMeta(raw: unknown): { fp?: string; chunks: number } | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const body = JSON.parse(raw) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const rec = body as Record<string, unknown>;
    if (typeof rec.chunks !== "number" || rec.chunks < 1 || !Number.isInteger(rec.chunks)) return undefined;
    if (rec.v === META_V && typeof rec.fp === "string") return { fp: rec.fp, chunks: rec.chunks };
    // Legacy meta `{ v: 1, rev, chunks }` — load recipes; fingerprint derived on read.
    if (rec.v === 1 && typeof rec.rev === "number") return { chunks: rec.chunks };
    return undefined;
  } catch {
    return undefined;
  }
}

function parseRecipes(json: string): Recipe[] | undefined {
  try {
    const body = JSON.parse(json) as unknown;
    if (!Array.isArray(body)) return undefined;
    return body as Recipe[];
  } catch {
    return undefined;
  }
}

/** Deletes every dynamic property for `source`. */
export function deleteSource(store: DynamicPropertyStore, source: string): void {
  if (!isValidSource(source)) return;
  for (const id of store.getDynamicPropertyIds()) {
    const parsed = parseSourceKey(id);
    if (parsed?.source === source) store.setDynamicProperty(id, undefined);
  }
}

/** Writes `recipes` as chunked blobs for `source`, replacing that prefix only. Empty `recipes` deletes. */
export function writeSource(
  store: DynamicPropertyStore,
  source: string,
  fp: string,
  recipes: readonly Recipe[],
  chunkLimit = DP_CHUNK_LIMIT,
): void {
  if (!isValidSource(source)) return;
  if (recipes.length === 0) {
    deleteSource(store, source);
    return;
  }
  const chunks = splitBlob(JSON.stringify(recipes), chunkLimit);
  const previous = parseMeta(store.getDynamicProperty(sourceMetaKey(source)));
  const previousChunks = previous?.chunks ?? 0;
  for (let i = chunks.length; i < previousChunks; i++) {
    store.setDynamicProperty(sourceChunkKey(source, i), undefined);
  }
  for (let i = 0; i < chunks.length; i++) {
    store.setDynamicProperty(sourceChunkKey(source, i), chunks[i]);
  }
  store.setDynamicProperty(
    sourceMetaKey(source),
    JSON.stringify({ v: META_V, fp, chunks: chunks.length }),
  );
}

/** Meta `fp` for `source` without reading chunk blobs. Legacy v:1 meta has none. */
export function readSourceFingerprint(store: DynamicPropertyStore, source: string): string | undefined {
  if (!isValidSource(source)) return undefined;
  return parseMeta(store.getDynamicProperty(sourceMetaKey(source)))?.fp;
}

/** Loads one persisted source, or undefined when meta/chunks are missing or malformed. */
export function readSource(store: DynamicPropertyStore, source: string): PersistedSource | undefined {
  if (!isValidSource(source)) return undefined;
  const meta = parseMeta(store.getDynamicProperty(sourceMetaKey(source)));
  if (meta === undefined) return undefined;
  let json = "";
  for (let i = 0; i < meta.chunks; i++) {
    const chunk = store.getDynamicProperty(sourceChunkKey(source, i));
    if (typeof chunk !== "string") return undefined;
    json += chunk;
  }
  const recipes = parseRecipes(json);
  if (recipes === undefined) return undefined;
  const fp = meta.fp ?? canonicalizeRecipes(recipes);
  return { source, fp, recipes };
}

/** Distinct persist sources present in `store`. */
export function listPersistedSources(store: DynamicPropertyStore): string[] {
  const sources = new Set<string>();
  for (const id of store.getDynamicPropertyIds()) {
    const parsed = parseSourceKey(id);
    if (parsed !== undefined) sources.add(parsed.source);
  }
  return [...sources];
}

/** Every well-formed persisted source in `store`. */
export function loadAllSources(store: DynamicPropertyStore): PersistedSource[] {
  const loaded: PersistedSource[] = [];
  for (const source of listPersistedSources(store)) {
    const entry = readSource(store, source);
    if (entry !== undefined) loaded.push(entry);
  }
  return loaded;
}
