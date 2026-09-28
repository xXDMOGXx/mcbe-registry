import { describe, expect, it } from "vitest";
import { createCatalog } from "./catalog.js";
import { CATALOG_HYDRATE_BUDGET, hydrateCatalogJob } from "./hydrateCatalog.js";
import { attachPersist } from "./persist.js";
import { writeSource, type DynamicPropertyStore } from "./sourceStore.js";

function memoryStore(): DynamicPropertyStore {
  const properties = new Map<string, string | number | boolean>();
  return {
    getDynamicProperty(id) {
      return properties.get(id);
    },
    setDynamicProperty(id, value) {
      if (value === undefined) properties.delete(id);
      else properties.set(id, value);
    },
    getDynamicPropertyIds() {
      return [...properties.keys()];
    },
  };
}

function recipe(id: string) {
  return {
    id,
    stations: ["minecraft:crafting_table"],
    inputs: ["minecraft:stick"],
    outputs: [id],
    type: "shapeless",
  };
}

describe("hydrateCatalogJob", () => {
  it("overlays persist after vanilla snapshot and before the job finishes", () => {
    const store = memoryStore();
    writeSource(store, "demo", "recipe", "fp-demo", [recipe("demo:overlay")]);
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, { runTimeout() {} });
    const vanilla = Array.from({ length: CATALOG_HYDRATE_BUDGET + 1 }, (_, i) => recipe(`test:r${i}`));
    const job = hydrateCatalogJob(catalog, vanilla, persist);

    expect(job.next().done).toBe(false);
    expect(catalog.get("demo:overlay")).toBeUndefined();

    while (!job.next().done) {
      /* drain yields */
    }
    expect(catalog.get("test:r0")).toBeDefined();
    expect(catalog.get("demo:overlay")?.outputs).toEqual(["demo:overlay"]);
  });
});
