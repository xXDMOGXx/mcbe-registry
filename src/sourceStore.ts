import { DEFAULT_REGISTRY_KIND, isRegistryKind, REGISTRY_KINDS } from "@mcbe-registry/client/kinds";
import { isValidSource } from "@mcbe-registry/client/source";

/** World dynamic-property key prefix for one registering pack's per-kind blobs. */
export const SOURCE_KEY_PREFIX = "bedrockregistry:src:";

/** Schema-3 persist prefix; left in place and never parsed. */
export const LEGACY_SOURCE_KEY_PREFIX = "reciperegistry:src:";

/** Character budget per blob, below Bedrock's 32,767-char property cap. */
export const DP_CHUNK_LIMIT = 24000;

/** Ticks after `ready` before unsynced persisted sources are dropped (60s at 20 TPS). */
export const SYNC_GRACE_TICKS = 1200;

/** Persist meta format version (`fp` field). */
const META_V = 2;

/** Structural slice of `world` used to read/write catalog blobs. */
export interface DynamicPropertyStore {
  getDynamicProperty(id: string): unknown;
  setDynamicProperty(id: string, value: string | number | boolean | undefined): void;
  getDynamicPropertyIds(): string[];
}

/** One persisted `(source, kind)` blob loaded from world dynamic properties. */
export interface PersistedSource {
  source: string;
  kind: string;
  fp: string;
  documents: unknown[];
}

/** True when `source` is a legal persist key. */
export { isValidSource };

/** Meta dynamic-property key for `(source, kind)`. */
export function sourceMetaKey(source: string, kind: string = DEFAULT_REGISTRY_KIND): string {
  return `${SOURCE_KEY_PREFIX}${source}:${kind}:meta`;
}

/** Chunk dynamic-property key for `(source, kind)` at `index`. */
export function sourceChunkKey(source: string, kind: string, index: number): string {
  return `${SOURCE_KEY_PREFIX}${source}:${kind}:${index}`;
}

/** Slices `json` into blobs of at most `limit` characters. */
export function splitBlob(json: string, limit = DP_CHUNK_LIMIT): string[] {
  if (json.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += limit) chunks.push(json.slice(i, i + limit));
  return chunks;
}

function parseSourceKey(key: string): { source: string; kind: string; slot: "meta" | number } | undefined {
  if (!key.startsWith(SOURCE_KEY_PREFIX)) return undefined;
  const rest = key.slice(SOURCE_KEY_PREFIX.length);
  const first = rest.indexOf(":");
  const last = rest.lastIndexOf(":");
  if (first < 1 || last <= first) return undefined;
  const source = rest.slice(0, first);
  const kind = rest.slice(first + 1, last);
  const tail = rest.slice(last + 1);
  if (!isValidSource(source) || !isRegistryKind(kind)) return undefined;
  if (tail === "meta") return { source, kind, slot: "meta" };
  if (/^\d+$/.test(tail)) return { source, kind, slot: Number(tail) };
  return undefined;
}

function parseMeta(raw: unknown): { fp: string; chunks: number } | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const body = JSON.parse(raw) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const rec = body as Record<string, unknown>;
    if (typeof rec.chunks !== "number" || rec.chunks < 1 || !Number.isInteger(rec.chunks)) return undefined;
    if (rec.v === META_V && typeof rec.fp === "string") return { fp: rec.fp, chunks: rec.chunks };
    return undefined;
  } catch {
    return undefined;
  }
}

function parseDocuments(json: string): unknown[] | undefined {
  try {
    const body = JSON.parse(json) as unknown;
    if (!Array.isArray(body)) return undefined;
    return body;
  } catch {
    return undefined;
  }
}

/** Deletes dynamic properties for one `(source, kind)` pair using that blob's meta chunk count. */
export function deleteSourceKind(store: DynamicPropertyStore, source: string, kind: string): void {
  if (!isValidSource(source) || !isRegistryKind(kind)) return;
  const previous = parseMeta(store.getDynamicProperty(sourceMetaKey(source, kind)));
  store.setDynamicProperty(sourceMetaKey(source, kind), undefined);
  const n = previous?.chunks ?? 0;
  for (let i = 0; i < n; i++) {
    store.setDynamicProperty(sourceChunkKey(source, kind, i), undefined);
  }
}

/** Deletes every dynamic property for `source` (all kinds). */
export function deleteSource(store: DynamicPropertyStore, source: string): void {
  if (!isValidSource(source)) return;
  for (const kind of REGISTRY_KINDS) deleteSourceKind(store, source, kind);
}

/** Writes `documents` as chunked blobs for `(source, kind)`. Empty list deletes that pair. */
export function writeSource(
  store: DynamicPropertyStore,
  source: string,
  kind: string,
  fp: string,
  documents: readonly unknown[],
  chunkLimit = DP_CHUNK_LIMIT,
): void {
  if (!isValidSource(source) || !isRegistryKind(kind)) return;
  if (documents.length === 0) {
    deleteSourceKind(store, source, kind);
    return;
  }
  const chunks = splitBlob(JSON.stringify(documents), chunkLimit);
  const previous = parseMeta(store.getDynamicProperty(sourceMetaKey(source, kind)));
  const previousChunks = previous?.chunks ?? 0;
  for (let i = chunks.length; i < previousChunks; i++) {
    store.setDynamicProperty(sourceChunkKey(source, kind, i), undefined);
  }
  for (let i = 0; i < chunks.length; i++) {
    store.setDynamicProperty(sourceChunkKey(source, kind, i), chunks[i]);
  }
  store.setDynamicProperty(
    sourceMetaKey(source, kind),
    JSON.stringify({ v: META_V, fp, chunks: chunks.length }),
  );
}

/** Meta `fp` for `(source, kind)` without reading chunk blobs. */
export function readSourceFingerprint(
  store: DynamicPropertyStore,
  source: string,
  kind: string = DEFAULT_REGISTRY_KIND,
): string | undefined {
  if (!isValidSource(source) || !isRegistryKind(kind)) return undefined;
  return parseMeta(store.getDynamicProperty(sourceMetaKey(source, kind)))?.fp;
}

/** Loads one persisted `(source, kind)` blob, or undefined when meta/chunks are missing or malformed. */
export function readSource(
  store: DynamicPropertyStore,
  source: string,
  kind: string = DEFAULT_REGISTRY_KIND,
): PersistedSource | undefined {
  if (!isValidSource(source) || !isRegistryKind(kind)) return undefined;
  const meta = parseMeta(store.getDynamicProperty(sourceMetaKey(source, kind)));
  if (meta === undefined) return undefined;
  let json = "";
  for (let i = 0; i < meta.chunks; i++) {
    const chunk = store.getDynamicProperty(sourceChunkKey(source, kind, i));
    if (typeof chunk !== "string") return undefined;
    json += chunk;
  }
  const documents = parseDocuments(json);
  if (documents === undefined) return undefined;
  return { source, kind, fp: meta.fp, documents };
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

/** Distinct `(source, kind)` pairs present in `store`. */
export function listPersistedBlobs(store: DynamicPropertyStore): { source: string; kind: string }[] {
  const seen = new Set<string>();
  const out: { source: string; kind: string }[] = [];
  for (const id of store.getDynamicPropertyIds()) {
    const parsed = parseSourceKey(id);
    if (parsed === undefined) continue;
    const key = `${parsed.source}\0${parsed.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: parsed.source, kind: parsed.kind });
  }
  return out;
}

/** Every well-formed persisted blob in `store`. */
export function loadAllSources(store: DynamicPropertyStore): PersistedSource[] {
  const loaded: PersistedSource[] = [];
  for (const blob of listPersistedBlobs(store)) {
    const entry = readSource(store, blob.source, blob.kind);
    if (entry !== undefined) loaded.push(entry);
  }
  return loaded;
}
