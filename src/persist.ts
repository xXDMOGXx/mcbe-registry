import { DEFAULT_REGISTRY_KIND, REGISTRY_KINDS } from "@mcbe-registry/client/kinds";
import type { Catalog } from "./catalog.js";
import {
  SYNC_GRACE_TICKS,
  deleteSource,
  deleteSourceKind,
  listPersistedBlobs,
  loadAllSources,
  readSource,
  readSourceFingerprint,
  writeSource,
  type DynamicPropertyStore,
} from "./sourceStore.js";

function blobKey(source: string, kind: string): string {
  return `${source}\0${kind}`;
}

function parseBlobKey(key: string): { source: string; kind: string } {
  const split = key.indexOf("\0");
  return { source: key.slice(0, split), kind: key.slice(split + 1) };
}

/** World-persist hooks the IPC host uses after vanilla load. */
export interface PersistHooks {
  /** Stored fingerprint for `(source, kind)`, if that blob is persisted. */
  fpOf(source: string, kind?: string): string | undefined;
  /** Updates RAM `fp` now; queues a world-DP rewrite for a later tick. */
  save(source: string, fp: string, kind?: string): void;
  /** Drops that source from RAM, the persist queue, and world properties (all kinds). */
  drop(source: string): void;
  /** Marks `source` as seen this session so the grace timer will not drop it. */
  heard(source: string): void;
  /** Overlays persisted blobs for `(source, kind)` into the catalog. False if blobs are missing. */
  hydrateSource(source: string, kind?: string): boolean;
}

/** Session persist handle the IPC host uses after vanilla load. */
export interface PersistSession extends PersistHooks {
  /** Overlays persisted sources from world DPs and starts the unsynced-source grace timer. */
  loadFromWorld(): void;
  /** One persisted blob per yield, then starts grace. */
  loadFromWorldJob(): Generator<void, void, void>;
  /** Starts the unsynced-source grace timer (no overlay). */
  startGrace(): void;
  /** Persisted blobs currently in RAM: `{ source, kind, fp, size }`. */
  sources(): { source: string; kind: string; fp: string; size: number }[];
}

/** Injected clock for grace and deferred persist DP writes. */
export interface PersistClock {
  /** Schedules `callback` after `ticks` (Bedrock `system.runTimeout`). */
  runTimeout(callback: () => void, ticks: number): void;
}

/** Optional notify after a source is dropped from RAM and world DPs. */
export interface PersistDropHooks {
  onDropped?(source: string, kinds: string[]): void;
}

/**
 * Empty persist session over an injected DP store. Overlay reads happen in
 * {@link PersistSession.loadFromWorld} or {@link PersistHooks.hydrateSource}.
 */
export function attachPersist(
  catalog: Catalog,
  store: DynamicPropertyStore,
  clock: PersistClock,
  dropHooks?: PersistDropHooks,
): PersistSession {
  const fingerprints = new Map<string, string>();
  const heardSources = new Set<string>();
  /** Queued DP work: `fp` writes the current catalog; `undefined` deletes. */
  const queued = new Map<string, string | undefined>();
  let drainScheduled = false;

  function applyLoaded(source: string, kind: string): boolean {
    if (catalog.documentsForSource(source, kind).length > 0) return true;
    const loaded = readSource(store, source, kind);
    if (loaded === undefined) return false;
    catalog.replaceSource(loaded.source, loaded.documents, loaded.kind);
    fingerprints.set(blobKey(loaded.source, loaded.kind), loaded.fp);
    return true;
  }

  function kindsOwned(source: string): string[] {
    const kinds: string[] = [];
    for (const kind of REGISTRY_KINDS) {
      if (catalog.documentsForSource(source, kind).length > 0) kinds.push(kind);
    }
    return kinds;
  }

  function startGrace(): void {
    clock.runTimeout(() => {
      const blobs = listPersistedBlobs(store);
      const unheard = new Set<string>();
      for (const blob of blobs) {
        if (heardSources.has(blob.source)) continue;
        unheard.add(blob.source);
        queued.delete(blobKey(blob.source, blob.kind));
        fingerprints.delete(blobKey(blob.source, blob.kind));
      }
      for (const source of unheard) {
        const kinds = kindsOwned(source);
        catalog.dropSource(source);
        deleteSource(store, source);
        dropHooks?.onDropped?.(source, kinds);
      }
    }, SYNC_GRACE_TICKS);
  }

  /** Queues a DP write or delete and schedules a one-blob drain if idle. */
  function enqueue(source: string, kind: string, fp: string | undefined): void {
    queued.set(blobKey(source, kind), fp);
    if (drainScheduled) return;
    drainScheduled = true;
    clock.runTimeout(flushOne, 1);
  }

  /** Writes or deletes the next queued blob, then reschedules if more remain. */
  function flushOne(): void {
    const next = queued.entries().next();
    if (next.done) {
      drainScheduled = false;
      return;
    }
    const [key, fp] = next.value;
    queued.delete(key);
    const { source, kind } = parseBlobKey(key);
    const documents = catalog.documentsForSource(source, kind);
    if (fp === undefined || documents.length === 0) {
      deleteSourceKind(store, source, kind);
      fingerprints.delete(key);
    } else {
      writeSource(store, source, kind, fp, documents);
    }
    if (queued.size > 0) clock.runTimeout(flushOne, 1);
    else drainScheduled = false;
  }

  return {
    loadFromWorld() {
      for (const loaded of loadAllSources(store)) {
        catalog.replaceSource(loaded.source, loaded.documents, loaded.kind);
        fingerprints.set(blobKey(loaded.source, loaded.kind), loaded.fp);
      }
      startGrace();
    },
    *loadFromWorldJob(): Generator<void, void, void> {
      for (const blob of listPersistedBlobs(store)) {
        applyLoaded(blob.source, blob.kind);
        yield;
      }
      startGrace();
    },
    startGrace,
    fpOf(source, kind = DEFAULT_REGISTRY_KIND) {
      return fingerprints.get(blobKey(source, kind)) ?? readSourceFingerprint(store, source, kind);
    },
    hydrateSource(source, kind = DEFAULT_REGISTRY_KIND) {
      return applyLoaded(source, kind);
    },
    save(source, fp, kind = DEFAULT_REGISTRY_KIND) {
      const documents = catalog.documentsForSource(source, kind);
      const key = blobKey(source, kind);
      if (documents.length === 0) {
        fingerprints.delete(key);
        enqueue(source, kind, undefined);
        return;
      }
      fingerprints.set(key, fp);
      enqueue(source, kind, fp);
    },
    drop(source) {
      const kinds = kindsOwned(source);
      for (const key of [...queued.keys()]) {
        if (parseBlobKey(key).source === source) queued.delete(key);
      }
      heardSources.delete(source);
      catalog.dropSource(source);
      deleteSource(store, source);
      for (const key of [...fingerprints.keys()]) {
        if (parseBlobKey(key).source === source) fingerprints.delete(key);
      }
      dropHooks?.onDropped?.(source, kinds);
    },
    heard(source) {
      heardSources.add(source);
    },
    sources() {
      const rows: { source: string; kind: string; fp: string; size: number }[] = [];
      for (const [key, fp] of fingerprints) {
        const { source, kind } = parseBlobKey(key);
        rows.push({ source, kind, fp, size: catalog.documentsForSource(source, kind).length });
      }
      return rows;
    },
  };
}
