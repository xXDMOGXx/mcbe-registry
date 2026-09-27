import type { Catalog } from "./catalog.js";
import {
  SYNC_GRACE_TICKS,
  deleteSource,
  listPersistedSources,
  loadAllSources,
  readSource,
  readSourceFingerprint,
  writeSource,
  type DynamicPropertyStore,
} from "./sourceStore.js";

/** World-persist hooks the schema-3 IPC host uses after vanilla load. */
export interface PersistHooks {
  /** Stored fingerprint for `source`, if that pack is persisted. */
  fpOf(source: string): string | undefined;
  /** Updates RAM `fp` now; queues a world-DP rewrite for a later tick. */
  save(source: string, fp: string): void;
  /** Drops that source from RAM, the persist queue, and world properties. */
  drop(source: string): void;
  /** Marks `source` as seen this session so the grace timer will not drop it. */
  heard(source: string): void;
  /** Overlays persisted blobs for `source` into the catalog. False if blobs are missing. */
  hydrateSource(source: string): boolean;
}

/** Session persist handle the IPC host uses after vanilla load. */
export interface PersistSession extends PersistHooks {
  /** Overlays persisted sources from world DPs and starts the unsynced-source grace timer. */
  loadFromWorld(): void;
  /** One persisted source per yield, then starts grace. */
  loadFromWorldJob(): Generator<void, void, void>;
  /** Starts the unsynced-source grace timer (no overlay). */
  startGrace(): void;
  /** Persisted sources currently in RAM: `{ source, fp, size }`. */
  sources(): { source: string; fp: string; size: number }[];
}

/** Injected clock for grace and deferred persist DP writes. */
export interface PersistClock {
  /** Schedules `callback` after `ticks` (Bedrock `system.runTimeout`). */
  runTimeout(callback: () => void, ticks: number): void;
}

/**
 * Empty persist session over an injected DP store. Overlay reads happen in
 * {@link PersistSession.loadFromWorld} or {@link PersistHooks.hydrateSource}.
 */
export function attachPersist(
  catalog: Catalog,
  store: DynamicPropertyStore,
  clock: PersistClock,
): PersistSession {
  const fingerprints = new Map<string, string>();
  const heardSources = new Set<string>();
  /** Queued DP work: `fp` writes the current catalog; `undefined` deletes. */
  const queued = new Map<string, string | undefined>();
  let drainScheduled = false;

  function applyLoaded(source: string): boolean {
    if (catalog.recipesForSource(source).length > 0) return true;
    const loaded = readSource(store, source);
    if (loaded === undefined) return false;
    catalog.replaceSource(loaded.source, loaded.recipes);
    fingerprints.set(loaded.source, loaded.fp);
    return true;
  }

  function startGrace(): void {
    clock.runTimeout(() => {
      for (const source of listPersistedSources(store)) {
        if (heardSources.has(source)) continue;
        queued.delete(source);
        catalog.dropSource(source);
        deleteSource(store, source);
        fingerprints.delete(source);
      }
    }, SYNC_GRACE_TICKS);
  }

  /** Queues a DP write or delete and schedules a one-source drain if idle. */
  function enqueue(source: string, fp: string | undefined): void {
    queued.set(source, fp);
    if (drainScheduled) return;
    drainScheduled = true;
    clock.runTimeout(flushOne, 1);
  }

  /** Writes or deletes the next queued source, then reschedules if more remain. */
  function flushOne(): void {
    const next = queued.entries().next();
    if (next.done) {
      drainScheduled = false;
      return;
    }
    const [source, fp] = next.value;
    queued.delete(source);
    const recipes = catalog.recipesForSource(source);
    if (fp === undefined || recipes.length === 0) {
      deleteSource(store, source);
      fingerprints.delete(source);
    } else {
      writeSource(store, source, fp, recipes);
    }
    if (queued.size > 0) clock.runTimeout(flushOne, 1);
    else drainScheduled = false;
  }

  return {
    loadFromWorld() {
      for (const loaded of loadAllSources(store)) {
        catalog.replaceSource(loaded.source, loaded.recipes);
        fingerprints.set(loaded.source, loaded.fp);
      }
      startGrace();
    },
    *loadFromWorldJob(): Generator<void, void, void> {
      for (const source of listPersistedSources(store)) {
        applyLoaded(source);
        yield;
      }
      startGrace();
    },
    startGrace,
    fpOf(source) {
      return fingerprints.get(source) ?? readSourceFingerprint(store, source);
    },
    hydrateSource(source) {
      return applyLoaded(source);
    },
    save(source, fp) {
      const recipes = catalog.recipesForSource(source);
      if (recipes.length === 0) {
        fingerprints.delete(source);
        enqueue(source, undefined);
        return;
      }
      fingerprints.set(source, fp);
      enqueue(source, fp);
    },
    drop(source) {
      queued.delete(source);
      heardSources.delete(source);
      catalog.dropSource(source);
      deleteSource(store, source);
      fingerprints.delete(source);
    },
    heard(source) {
      heardSources.add(source);
    },
    sources() {
      const rows: { source: string; fp: string; size: number }[] = [];
      for (const [source, fp] of fingerprints) {
        rows.push({ source, fp, size: catalog.recipesForSource(source).length });
      }
      return rows;
    },
  };
}
