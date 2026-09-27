import { describe, expect, it } from "vitest";
import { createCatalog } from "./catalog.js";
import { attachPersist } from "./persist.js";
import { SYNC_GRACE_TICKS, readSource, writeSource, type DynamicPropertyStore } from "./sourceStore.js";

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
  advance(ticks: number): void;
} {
  const pending: { at: number; callback: () => void }[] = [];
  let now = 0;
  return {
    runTimeout(callback, ticks) {
      pending.push({ at: now + ticks, callback });
    },
    advance(ticks) {
      now += ticks;
      const due = pending.filter((entry) => entry.at <= now);
      pending.splice(0, pending.length, ...pending.filter((entry) => entry.at > now));
      for (const entry of due) entry.callback();
    },
  };
}

const addon = {
  id: "demo:fiber_block_from_fiber",
  stations: ["minecraft:crafting_table"],
  inputs: ["demo:raw_fiber", "demo:raw_fiber", "demo:raw_fiber", "demo:raw_fiber"],
  outputs: ["demo:fiber_block"],
  type: "shapeless",
};

describe("attachPersist", () => {
  it("does not read world dynamic properties until loadFromWorld", () => {
    const store = memoryStore();
    writeSource(store, "demo", "fp-demo", [addon]);
    const catalog = createCatalog();
    attachPersist(catalog, store, deferredClock());
    expect(catalog.get("demo:fiber_block_from_fiber")).toBeUndefined();
  });

  it("overlays persisted recipes onto the catalog", () => {
    const store = memoryStore();
    writeSource(store, "demo", "fp-demo", [addon]);
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, deferredClock());
    persist.loadFromWorld();
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(addon);
    expect(catalog.sourceOf("demo:fiber_block_from_fiber")).toBe("demo");
  });

  it("drops unsynced sources after the grace timeout and deletes their blobs", () => {
    const store = memoryStore();
    const clock = deferredClock();
    const catalog = createCatalog();
    catalog.register({
      id: "minecraft:stick",
      stations: ["minecraft:crafting_table"],
      inputs: ["minecraft:oak_planks"],
      outputs: [{ item: "minecraft:stick", count: 4 }],
    });
    catalog.snapshotVanilla();
    writeSource(store, "demo", "fp-demo", [
      {
        id: "minecraft:stick",
        stations: ["minecraft:crafting_table"],
        inputs: ["minecraft:oak_planks"],
        outputs: [{ item: "minecraft:stick", count: 99 }],
      },
      addon,
    ]);
    const persist = attachPersist(catalog, store, clock);
    persist.loadFromWorld();
    expect(catalog.get("minecraft:stick")!.outputs).toEqual([{ item: "minecraft:stick", count: 99 }]);
    clock.advance(SYNC_GRACE_TICKS);
    expect(catalog.get("demo:fiber_block_from_fiber")).toBeUndefined();
    expect(catalog.get("minecraft:stick")!.outputs).toEqual([{ item: "minecraft:stick", count: 4 }]);
    expect(store.getDynamicPropertyIds().some((id) => id.includes("reciperegistry:src:demo"))).toBe(false);
  });

  it("keeps a source that syncs before grace", () => {
    const store = memoryStore();
    const clock = deferredClock();
    writeSource(store, "demo", "fp-demo", [addon]);
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, clock);
    persist.loadFromWorld();
    persist.heard("demo");
    clock.advance(SYNC_GRACE_TICKS);
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(addon);
  });

  it("loadFromWorldJob overlays one source per yield then starts grace", () => {
    const store = memoryStore();
    const clock = deferredClock();
    writeSource(store, "demo", "fp-demo", [addon]);
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, clock);
    const job = persist.loadFromWorldJob();
    expect(catalog.get("demo:fiber_block_from_fiber")).toBeUndefined();
    expect(job.next().done).toBe(false);
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(addon);
    expect(job.next().done).toBe(true);
    persist.heard("demo");
    clock.advance(SYNC_GRACE_TICKS);
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(addon);
  });

  it("save sets fpOf immediately and writes DPs after one clock tick", () => {
    const store = memoryStore();
    const clock = deferredClock();
    const catalog = createCatalog();
    catalog.replaceSource("demo", [addon]);
    const persist = attachPersist(catalog, store, clock);
    persist.save("demo", "fp-demo");
    expect(persist.fpOf("demo")).toBe("fp-demo");
    expect(readSource(store, "demo")).toBeUndefined();
    clock.advance(1);
    expect(readSource(store, "demo")?.fp).toBe("fp-demo");
    expect(readSource(store, "demo")?.recipes).toEqual([addon]);
  });

  it("save coalesces one source to the last fp and writes one source per tick", () => {
    const store = memoryStore();
    const clock = deferredClock();
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, clock);
    const other = { ...addon, id: "other:block" };
    catalog.replaceSource("demo", [addon]);
    persist.save("demo", "fp-old");
    catalog.replaceSource("demo", [{ ...addon, outputs: ["demo:fiber_block_alt"] }]);
    persist.save("demo", "fp-new");
    catalog.replaceSource("other", [other]);
    persist.save("other", "fp-other");
    clock.advance(1);
    expect(readSource(store, "demo")?.fp).toBe("fp-new");
    expect(readSource(store, "other")).toBeUndefined();
    clock.advance(1);
    expect(readSource(store, "other")?.fp).toBe("fp-other");
  });

  it("drop cancels a queued save and deletes blobs immediately", () => {
    const store = memoryStore();
    const clock = deferredClock();
    const catalog = createCatalog();
    writeSource(store, "demo", "fp-demo", [addon]);
    catalog.replaceSource("demo", [addon]);
    const persist = attachPersist(catalog, store, clock);
    persist.save("demo", "fp-next");
    persist.drop("demo");
    expect(persist.fpOf("demo")).toBeUndefined();
    expect(readSource(store, "demo")).toBeUndefined();
    clock.advance(1);
    expect(readSource(store, "demo")).toBeUndefined();
  });

  it("fpOf peeks meta without overlaying recipes", () => {
    const store = memoryStore();
    writeSource(store, "demo", "fp-demo", [addon]);
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, deferredClock());
    expect(persist.fpOf("demo")).toBe("fp-demo");
    expect(catalog.get("demo:fiber_block_from_fiber")).toBeUndefined();
  });

  it("hydrateSource overlays one source and startGrace drops unheard persist keys", () => {
    const store = memoryStore();
    const clock = deferredClock();
    writeSource(store, "demo", "fp-demo", [addon]);
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, clock);
    persist.startGrace();
    expect(persist.hydrateSource("demo")).toBe(true);
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(addon);
    clock.advance(SYNC_GRACE_TICKS);
    expect(catalog.get("demo:fiber_block_from_fiber")).toBeUndefined();
    expect(readSource(store, "demo")).toBeUndefined();
  });
});
