import type { Catalog } from "./catalog.js";
import type { PersistSession } from "./persist.js";

/** Vanilla `catalog.register` calls per `runJob` yield. */
export const CATALOG_HYDRATE_BUDGET = 150;

/**
 * Registers vanilla recipes, snapshots vanilla, then starts persist grace.
 * Yields after every {@link CATALOG_HYDRATE_BUDGET} registers. Overlay waits on ping.
 */
export function* hydrateCatalogJob(
  catalog: Catalog,
  vanilla: readonly unknown[],
  persist: PersistSession,
): Generator<void, void, void> {
  let n = 0;
  for (const recipe of vanilla) {
    catalog.register(recipe);
    n++;
    if (n >= CATALOG_HYDRATE_BUDGET) {
      n = 0;
      yield;
    }
  }
  catalog.snapshotVanilla();
  persist.startGrace();
}
