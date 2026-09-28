import type { Catalog } from "./catalog.js";
import type { PersistSession } from "./persist.js";

/** Vanilla `catalog.register` calls per `runJob` yield. */
export const CATALOG_HYDRATE_BUDGET = 150;

/**
 * Registers vanilla fluids, loot, and recipes, snapshots vanilla, overlays persist
 * blobs, then starts persist grace. Yields after every {@link CATALOG_HYDRATE_BUDGET}
 * vanilla registers and after each persist blob.
 */
export function* hydrateCatalogJob(
  catalog: Catalog,
  vanilla: readonly unknown[],
  persist: PersistSession,
  extras?: { fluids?: readonly unknown[]; loot?: readonly unknown[] },
): Generator<void, void, void> {
  let n = 0;
  /** Registers vanilla fluids, loot, and recipes; yields after every {@link CATALOG_HYDRATE_BUDGET} stores. */
  const bump = function* (): Generator<void, void, void> {
    n++;
    if (n >= CATALOG_HYDRATE_BUDGET) {
      n = 0;
      yield;
    }
  };
  for (const fluid of extras?.fluids ?? []) {
    catalog.registerDocument("fluid", fluid);
    yield* bump();
  }
  for (const loot of extras?.loot ?? []) {
    catalog.registerDocument("loot", loot);
    yield* bump();
  }
  for (const recipe of vanilla) {
    catalog.register(recipe);
    yield* bump();
  }
  catalog.snapshotVanilla();
  yield* persist.loadFromWorldJob();
}
