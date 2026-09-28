import { describe, expect, it } from "vitest";
import { createCatalog } from "./catalog.js";
import { matchRecipeIds, matchRecipeResults } from "./match.js";
import { VANILLA_RECIPES } from "./vanillaCatalog.js";
import { VANILLA_ITEM_TAGS, VANILLA_BLOCK_TAGS } from "./vanillaProject.js";

describe("createCatalog", () => {
  it("stores a four-field recipe without duration or energy", () => {
    const catalog = createCatalog();
    expect(
      catalog.register({
        id: "mymod:crush_cobble",
        stations: ["mymod:crusher"],
        inputs: ["minecraft:cobblestone"],
        outputs: ["minecraft:gravel"],
      }),
    ).toBe(true);
    const stored = catalog.get("mymod:crush_cobble")!;
    expect(stored.duration).toBeUndefined();
    expect(stored.energy).toBeUndefined();
    expect(stored.extra).toBeUndefined();
  });

  it("stores duration, energy, extra, leftover, and unknown keys", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "mymod:x",
      stations: ["mymod:a"],
      inputs: ["minecraft:milk_bucket"],
      outputs: ["minecraft:cake"],
      leftover: "minecraft:bucket",
      duration: 100,
      energy: 20,
      extra: { note: "keep" },
      foreign: 1,
    });
    const stored = catalog.get("mymod:x")!;
    expect(stored.duration).toBe(100);
    expect(stored.energy).toBe(20);
    expect(stored.extra).toEqual({ note: "keep" });
    expect(stored.leftover).toBe("minecraft:bucket");
    expect(stored.foreign).toBe(1);
  });

  it("replaces by id without changing insertion order", () => {
    const catalog = createCatalog();
    catalog.register({ id: "a:one", stations: ["s"], inputs: ["minecraft:a"], outputs: ["minecraft:b"] });
    catalog.register({ id: "a:two", stations: ["s"], inputs: ["minecraft:c"], outputs: ["minecraft:d"] });
    catalog.register({
      id: "a:one",
      stations: ["s"],
      inputs: ["minecraft:a"],
      outputs: ["minecraft:replaced"],
    });
    expect(catalog.recipes().map((recipe) => recipe.id)).toEqual(["a:one", "a:two"]);
    expect(catalog.get("a:one")!.outputs).toEqual(["minecraft:replaced"]);
  });

  it("lists compact entries filtered by station", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "minecraft:stick",
      stations: ["minecraft:crafting_table"],
      inputs: [{ tag: "minecraft:planks" }],
      outputs: [{ item: "minecraft:stick", count: 4 }],
      type: "shaped",
    });
    catalog.register({
      id: "minecraft:furnace_beef",
      stations: ["minecraft:furnace", "minecraft:smoker"],
      inputs: ["minecraft:beef"],
      outputs: ["minecraft:cooked_beef"],
      type: "smelt",
    });
    expect(catalog.list({ station: "minecraft:furnace" }).map((entry) => entry.id)).toEqual(["minecraft:furnace_beef"]);
    expect(catalog.list({ station: "minecraft:crafting_table" })[0]).toEqual({
      id: "minecraft:stick",
      type: "shaped",
      stations: ["minecraft:crafting_table"],
    });
  });

  it("unregister deletes by id and is a no-op for a missing id", () => {
    const catalog = createCatalog();
    catalog.register({ id: "a:one", stations: ["s"], inputs: ["minecraft:a"], outputs: ["minecraft:b"] });
    catalog.unregister("missing");
    catalog.unregister("a:one");
    expect(catalog.get("a:one")).toBeUndefined();
    expect(catalog.size()).toBe(0);
  });

  it("rejects a document missing required fields", () => {
    const catalog = createCatalog();
    expect(catalog.register({ id: "a:one", stations: ["s"], inputs: [] })).toBe(false);
    expect(catalog.size()).toBe(0);
  });

  it("lists by output item without treating leftover as an output", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "minecraft:cake",
      stations: ["minecraft:crafting_table"],
      inputs: ["minecraft:milk_bucket"],
      outputs: ["minecraft:cake"],
      leftover: { item: "minecraft:bucket", count: 3 },
    });
    catalog.register({
      id: "minecraft:bucket",
      stations: ["minecraft:crafting_table"],
      inputs: ["minecraft:iron_ingot"],
      outputs: ["minecraft:bucket"],
    });
    expect(catalog.list({ output: "minecraft:bucket" }).map((entry) => entry.id)).toEqual(["minecraft:bucket"]);
    expect(catalog.list({ leftover: "minecraft:bucket" })).toEqual([
      {
        id: "minecraft:cake",
        stations: ["minecraft:crafting_table"],
        leftover: { item: "minecraft:bucket", count: 3 },
      },
    ]);
  });

  it("lists recipes by fluid input id without matching the bucket item", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "m:wet",
      stations: ["m:tank"],
      inputs: [{ fluid: "minecraft:water", amount: 3000 }],
      outputs: ["minecraft:wet_sponge"],
    });
    expect(catalog.list({ input: "minecraft:water" }).map((row) => row.id)).toEqual(["m:wet"]);
    expect(catalog.list({ input: "minecraft:water_bucket" })).toEqual([]);
    expect(catalog.matchIds({ station: "m:tank", inputs: ["minecraft:water_bucket"] })).toEqual([]);
  });

  it("replace and unregister keep the output index in sync", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "a:one",
      stations: ["s"],
      inputs: ["minecraft:a"],
      outputs: ["minecraft:stick"],
    });
    catalog.register({
      id: "a:one",
      stations: ["s"],
      inputs: ["minecraft:a"],
      outputs: ["minecraft:bowl"],
    });
    expect(catalog.list({ output: "minecraft:stick" })).toEqual([]);
    expect(catalog.list({ output: "minecraft:bowl" }).map((entry) => entry.id)).toEqual(["a:one"]);
    catalog.unregister("a:one");
    expect(catalog.list({ output: "minecraft:bowl" })).toEqual([]);
  });

  it("matchIds uses station and count postings, not a full catalog scan", () => {
    const tags = { "minecraft:oak_planks": ["minecraft:planks"] };
    const catalog = createCatalog({ tags: { item: tags } });
    catalog.register({
      id: "addon:stick",
      stations: ["minecraft:crafting_table"],
      inputs: [{ tag: "minecraft:planks", count: 2 }],
      outputs: [{ item: "minecraft:stick", count: 4 }],
      type: "shaped",
      pattern: ["A", "A"],
      key: { A: { tag: "minecraft:planks" } },
    });
    catalog.register({
      id: "addon:chest",
      stations: ["minecraft:crafting_table"],
      inputs: [{ tag: "minecraft:planks", count: 8 }],
      outputs: ["minecraft:chest"],
      type: "shaped",
      pattern: ["AAA", "A A", "AAA"],
      key: { A: { tag: "minecraft:planks" } },
    });
    catalog.register({
      id: "addon:furnace_cobble",
      stations: ["minecraft:furnace"],
      inputs: ["minecraft:cobblestone"],
      outputs: ["minecraft:stone"],
      type: "smelt",
    });
    expect(
      catalog.matchIds({
        station: "minecraft:crafting_table",
        pattern: ["A", "A"],
        key: { A: "minecraft:oak_planks" },
      }),
    ).toEqual(["addon:stick"]);
    expect(
      catalog.matchIds({
        station: "minecraft:crafting_table",
        pattern: ["AAA", "A A", "AAA"],
        key: { A: "minecraft:oak_planks" },
      }),
    ).toEqual(["addon:chest"]);
    expect(catalog.matchIds({ station: "minecraft:furnace", inputs: ["minecraft:cobblestone"] })).toEqual([
      "addon:furnace_cobble",
    ]);
    expect(
      catalog.matchIds({
        station: "minecraft:crafting_table",
        pattern: ["AAA", "A A", "AAA"],
        key: { A: "minecraft:cobblestone" },
      }),
    ).toEqual([]);
  });

  it("matchIds follows query-side tags without exploding tag members on register", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "addon:tagged",
      stations: ["m:m"],
      inputs: [{ tag: "addon:special" }],
      outputs: ["minecraft:stick"],
    });
    expect(
      catalog.matchIds({
        station: "m:m",
        inputs: [{ item: "addon:unknown", tags: ["addon:special"] }],
      }),
    ).toEqual(["addon:tagged"]);
  });

  it("replace and unregister drop stale match postings", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "a:one",
      stations: ["s"],
      inputs: ["minecraft:cobblestone"],
      outputs: ["minecraft:gravel"],
    });
    expect(catalog.matchIds({ station: "s", inputs: ["minecraft:cobblestone"] })).toEqual(["a:one"]);
    catalog.register({
      id: "a:one",
      stations: ["s"],
      inputs: ["minecraft:dirt"],
      outputs: ["minecraft:gravel"],
    });
    expect(catalog.matchIds({ station: "s", inputs: ["minecraft:cobblestone"] })).toEqual([]);
    expect(catalog.matchIds({ station: "s", inputs: ["minecraft:dirt"] })).toEqual(["a:one"]);
    catalog.unregister("a:one");
    expect(catalog.matchIds({ station: "s", inputs: ["minecraft:dirt"] })).toEqual([]);
  });

  it("dropSource restores the vanilla backup for overwritten ids", () => {
    const catalog = createCatalog();
    catalog.register({
      id: "minecraft:stick",
      stations: ["minecraft:crafting_table"],
      inputs: ["minecraft:oak_planks"],
      outputs: [{ item: "minecraft:stick", count: 4 }],
    });
    catalog.snapshotVanilla();
    catalog.register(
      {
        id: "minecraft:stick",
        stations: ["minecraft:crafting_table"],
        inputs: ["minecraft:oak_planks"],
        outputs: [{ item: "minecraft:stick", count: 99 }],
      },
      "demo",
    );
    catalog.register(
      {
        id: "demo:fiber",
        stations: ["minecraft:crafting_table"],
        inputs: ["demo:raw_fiber"],
        outputs: ["demo:fiber_block"],
      },
      "demo",
    );
    expect(catalog.get("minecraft:stick")!.outputs).toEqual([{ item: "minecraft:stick", count: 99 }]);
    catalog.dropSource("demo");
    expect(catalog.get("minecraft:stick")!.outputs).toEqual([{ item: "minecraft:stick", count: 4 }]);
    expect(catalog.get("demo:fiber")).toBeUndefined();
    expect(catalog.sourceOf("minecraft:stick")).toBeUndefined();
  });

  it("replaceSource steals an id from another source", () => {
    const catalog = createCatalog();
    catalog.register(
      {
        id: "shared:x",
        stations: ["s"],
        inputs: ["minecraft:a"],
        outputs: ["minecraft:b"],
      },
      "alpha",
    );
    const stolen = catalog.replaceSource("beta", [
      {
        id: "shared:x",
        stations: ["s"],
        inputs: ["minecraft:a"],
        outputs: ["minecraft:c"],
      },
    ]);
    expect(stolen).toEqual(["alpha"]);
    expect(catalog.sourceOf("shared:x")).toBe("beta");
    expect(catalog.recipesForSource("alpha")).toEqual([]);
    expect(catalog.get("shared:x")!.outputs).toEqual(["minecraft:c"]);
  });

  it("stores item documents independently of recipes", () => {
    const catalog = createCatalog();
    catalog.register(
      {
        id: "demo:craft",
        stations: ["s"],
        inputs: ["minecraft:a"],
        outputs: ["minecraft:b"],
      },
      "demo",
    );
    expect(
      catalog.registerDocument("item", { id: "demo:widget", extra: { keep: true }, texture: "demo/widget" }, "demo"),
    ).toBe(true);
    expect(catalog.getDocument("item", "demo:widget")).toEqual({
      id: "demo:widget",
      extra: { keep: true },
      texture: "demo/widget",
    });
    expect(catalog.listDocuments("item").map((row) => row.id)).toEqual(["demo:widget"]);
    expect(catalog.overlaySources("item")).toEqual(["demo"]);
    expect(catalog.overlaySources("recipe")).toEqual(["demo"]);
    catalog.replaceSource("demo", [{ id: "demo:widget", extra: { keep: false } }], "item");
    expect(catalog.get("demo:craft")?.outputs).toEqual(["minecraft:b"]);
    expect(catalog.getDocument("item", "demo:widget")?.extra).toEqual({ keep: false });
  });

  it("rejects unknown kinds", () => {
    const catalog = createCatalog();
    expect(catalog.registerDocument("machine", { id: "x" })).toBe(false);
  });
});

describe("catalog match index agrees with a full scan", () => {
  const catalog = createCatalog({ tags: { item: VANILLA_ITEM_TAGS } });
  for (const recipe of VANILLA_RECIPES) catalog.register(recipe);

  const queries = [
    {
      station: "minecraft:crafting_table",
      pattern: ["A", "A"],
      key: { A: "minecraft:oak_planks" },
    },
    {
      station: "minecraft:crafting_table",
      pattern: ["AAA", "A A", "AAA"],
      key: { A: "minecraft:oak_planks" },
    },
    {
      station: "minecraft:crafting_table",
      pattern: ["AAA", "A A", "AAA"],
      key: { A: "minecraft:cobblestone" },
    },
    { station: "minecraft:furnace", inputs: ["minecraft:beef"] },
    { station: "minecraft:furnace", inputs: ["minecraft:cobblestone"] },
    { station: "minecraft:smoker", inputs: ["minecraft:raw_iron"] },
    {
      station: "minecraft:crafting_table",
      pattern: ["AAA", "BEB", "CCC"],
      key: {
        A: "minecraft:milk_bucket",
        B: "minecraft:sugar",
        C: "minecraft:wheat",
        E: "minecraft:brown_egg",
      },
    },
  ] as const;

  it("returns the same ids and yields as scanning VANILLA_RECIPES", () => {
    for (const query of queries) {
      expect(catalog.matchIds(query)).toEqual(matchRecipeIds(VANILLA_RECIPES, query, VANILLA_ITEM_TAGS));
      expect(catalog.matchResults(query)).toEqual(matchRecipeResults(VANILLA_RECIPES, query, VANILLA_ITEM_TAGS));
    }
  });
});

describe("pack item tag indexes", () => {
  it("lists pack rows by displayName creator namespace and source", () => {
    const catalog = createCatalog();
    catalog.registerDocument(
      "pack",
      { id: "alpha", source: "alpha", displayName: "Shared", version: "1", namespace: "a", creator: "ann" },
      "alpha",
    );
    catalog.registerDocument(
      "pack",
      { id: "beta", source: "beta", displayName: "Shared", version: "2", namespace: "b", creator: "bob" },
      "beta",
    );
    expect(catalog.listDocuments("pack", { displayName: "Shared" }).map((row) => row.id).sort()).toEqual(["alpha", "beta"]);
    expect(catalog.listDocuments("pack", { creator: "ann" }).map((row) => row.id)).toEqual(["alpha"]);
    expect(catalog.listDocuments("pack", { namespace: "b" }).map((row) => row.id)).toEqual(["beta"]);
    expect(catalog.listDocuments("pack", { source: "beta" }).map((row) => row.id)).toEqual(["beta"]);
    expect(catalog.getDocument("pack", "alpha")).toMatchObject({ creator: "ann", version: "1" });
  });

  it("unions overlay tags and tag documents and retracts only the dropped source", () => {
    const catalog = createCatalog();
    catalog.registerDocument("item", { id: "mymod:bar", tags: ["mymod:ingots"], texture: "mymod/bar" }, "items");
    catalog.registerDocument(
      "tag",
      { id: "mymod:ingots", domain: "item", members: ["minecraft:iron_ingot"] },
      "tags",
    );
    expect(catalog.getDocument("item", "mymod:bar")).toMatchObject({ texture: "mymod/bar" });
    expect(catalog.listDocuments("tag", { domain: "item", id: "mymod:ingots" }).map((row) => row.id).sort()).toEqual([
      "minecraft:iron_ingot",
      "mymod:bar",
    ]);
    catalog.register({
      id: "mymod:ingot_recipe",
      stations: ["s"],
      inputs: [{ tag: "mymod:ingots" }],
      outputs: ["mymod:block"],
    });
    expect(catalog.matchIds({ station: "s", inputs: ["mymod:bar"] })).toEqual(["mymod:ingot_recipe"]);
    expect(catalog.matchIds({ station: "s", inputs: ["minecraft:iron_ingot"] })).toEqual(["mymod:ingot_recipe"]);
    catalog.dropSource("items");
    expect(catalog.getDocument("item", "mymod:bar")).toBeUndefined();
    expect(catalog.listDocuments("tag", { domain: "item", id: "mymod:ingots" }).map((row) => row.id)).toEqual([
      "minecraft:iron_ingot",
    ]);
    expect(catalog.matchIds({ station: "s", inputs: ["mymod:bar"] })).toEqual([]);
    expect(catalog.matchIds({ station: "s", inputs: ["minecraft:iron_ingot"] })).toEqual(["mymod:ingot_recipe"]);
  });

  it("keeps stolen item tag writes until that source is dropped", () => {
    const catalog = createCatalog();
    catalog.registerDocument("item", { id: "shared:x", tags: ["mymod:ingots"] }, "alpha");
    catalog.replaceSource("beta", [{ id: "shared:x", tags: [] }], "item");
    expect(catalog.sourceOfDocument("item", "shared:x")).toBe("beta");
    expect(catalog.listDocuments("tag", { id: "mymod:ingots" }).map((row) => row.id)).toEqual(["shared:x"]);
    catalog.dropSource("alpha");
    expect(catalog.listDocuments("tag", { id: "mymod:ingots" })).toEqual([]);
  });

  it("lists vanilla plank and block tag members with no overlay documents", () => {
    const catalog = createCatalog({ tags: { item: VANILLA_ITEM_TAGS, block: VANILLA_BLOCK_TAGS } });
    const planks = catalog.listDocuments("tag", { domain: "item", id: "minecraft:planks" }).map((row) => row.id);
    expect(planks).toContain("minecraft:oak_planks");
    expect(catalog.getDocument("item", "minecraft:oak_planks")).toBeUndefined();
    const diggable = catalog
      .listDocuments("tag", { domain: "block", id: "minecraft:diamond_pick_diggable" })
      .map((row) => row.id);
    expect(diggable).toContain("minecraft:diamond_ore");
    expect(catalog.getDocument("block", "minecraft:diamond_ore")).toBeUndefined();
  });
});
