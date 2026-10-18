import {
  DEFAULT_REGISTRY_KIND,
  canonicalizeDocuments,
  canonicalizeRecipes,
  isRegistryKind,
  type Recipe,
} from "@mcbe-registry/client";
import { documentHasBadAmount, type Catalog } from "./catalog.js";
import type { PersistHooks } from "./persist.js";
import { isValidSource } from "./sourceStore.js";

function documentIdOf(document: unknown): string | undefined {
  if (typeof document !== "object" || document === null) return undefined;
  const id = (document as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/** Fingerprint stored on persist meta for `(source, kind)`. */
export function fingerprintOf(kind: string, documents: readonly unknown[]): string {
  if (kind === DEFAULT_REGISTRY_KIND) return canonicalizeRecipes(documents as Recipe[]);
  const withIds = documents.filter(
    (d): d is { id: string } => typeof d === "object" && d !== null && typeof (d as { id?: unknown }).id === "string",
  );
  return canonicalizeDocuments(withIds);
}

/** Result of {@link ingestSourceKind}. */
export interface IngestSourceKindResult {
  /** False when `source` / `kind` / a document amount is invalid. */
  readonly ok: boolean;
  /** Persist fingerprint matched; catalog was not rewritten. */
  readonly matched: boolean;
  /** Other sources whose ids of this kind were stolen on a miss. */
  readonly stolen: readonly string[];
}

/**
 * Applies authored documents for `(source, kind)` the way IPC `register` does,
 * without a script-event round trip. Fingerprint match only marks `heard`.
 */
export function ingestSourceKind(
  catalog: Catalog,
  persist: PersistHooks | undefined,
  source: string,
  kind: string,
  documents: readonly unknown[],
): IngestSourceKindResult {
  if (!isValidSource(source) || !isRegistryKind(kind)) {
    return { ok: false, matched: false, stolen: [] };
  }
  for (const document of documents) {
    if (documentHasBadAmount(kind, document)) return { ok: false, matched: false, stolen: [] };
  }
  const fp = fingerprintOf(kind, documents);
  if (persist !== undefined && persist.fpOf(source, kind) === fp) {
    const firstId = documentIdOf(documents[0]);
    const inRam = firstId !== undefined && catalog.sourceOfDocument(kind, firstId) === source;
    if (inRam || persist.hydrateSource(source, kind)) {
      persist.heard(source);
      return { ok: true, matched: true, stolen: [] };
    }
  }
  const stolen = catalog.replaceSource(source, documents, kind);
  persist?.save(source, fp, kind);
  persist?.heard(source);
  if (persist !== undefined) {
    for (const other of stolen) {
      persist.save(other, fingerprintOf(kind, catalog.documentsForSource(other, kind)), kind);
    }
  }
  return { ok: true, matched: false, stolen };
}
