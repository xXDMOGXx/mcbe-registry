import { describe, expect, it, vi } from "vitest";
import { createCatalog } from "./catalog.js";
import { fingerprintOf, ingestSourceKind } from "./ingestSourceKind.js";
import { attachPersist } from "./persist.js";
import { type DynamicPropertyStore } from "./sourceStore.js";

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

function deferredClock(): {
  runTimeout(callback: () => void, ticks: number): void;
} {
  return {
    runTimeout() {},
  };
}

const recipe = {
  id: "xxdmogxx_dns:copper_wire",
  stations: ["minecraft:crafting_table"],
  inputs: ["minecraft:copper_ingot"],
  outputs: ["xxdmogxx_dns:copper_wire"],
  type: "shapeless",
};

describe("ingestSourceKind", () => {
  it("writes the catalog and persist on fingerprint miss", () => {
    const catalog = createCatalog();
    const persist = attachPersist(catalog, memoryStore(), deferredClock());
    const result = ingestSourceKind(catalog, persist, "xxdmogxx_dns", "recipe", [recipe]);
    expect(result).toEqual({ ok: true, matched: false, stolen: [] });
    expect(catalog.get("xxdmogxx_dns:copper_wire")).toEqual(recipe);
    expect(catalog.sourceOf("xxdmogxx_dns:copper_wire")).toBe("xxdmogxx_dns");
    expect(persist.fpOf("xxdmogxx_dns", "recipe")).toBe(fingerprintOf("recipe", [recipe]));
  });

  it("marks heard and does not rewrite on fingerprint match", () => {
    const catalog = createCatalog();
    const inner = attachPersist(catalog, memoryStore(), deferredClock());
    const persist = {
      fpOf: inner.fpOf.bind(inner),
      hydrateSource: vi.fn(inner.hydrateSource.bind(inner)),
      heard: inner.heard.bind(inner),
      save: inner.save.bind(inner),
      drop: inner.drop.bind(inner),
    };
    ingestSourceKind(catalog, persist, "xxdmogxx_dns", "recipe", [recipe]);
    persist.hydrateSource.mockClear();
    const result = ingestSourceKind(catalog, persist, "xxdmogxx_dns", "recipe", [recipe]);
    expect(result).toEqual({ ok: true, matched: true, stolen: [] });
    expect(persist.hydrateSource).not.toHaveBeenCalled();
    expect(catalog.get("xxdmogxx_dns:copper_wire")).toEqual(recipe);
  });
});
