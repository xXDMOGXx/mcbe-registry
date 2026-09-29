import { describe, expect, it } from "vitest";
import { applyEngineTagDump, mergeGapBlockLoot, mergeLootJsonThenDump, mergeRecipesJsonThenDump, mergeTagMaps } from "./vanillaSnapshotMerge.js";

describe("mergeRecipesJsonThenDump", () => {
  it("keeps samples recipes and appends dump rows only for missing ids", () => {
    const json = [
      {
        id: "minecraft:stick",
        stations: ["minecraft:crafting_table"],
        inputs: [{ item: "minecraft:oak_planks", count: 2 }],
        outputs: [{ item: "minecraft:stick", count: 4 }],
        type: "shaped",
        pattern: ["#", "#"],
        key: { "#": "minecraft:oak_planks" },
      },
    ];
    const dump = [
      {
        id: "minecraft:wooden_button",
        stations: ["minecraft:crafting_table"],
        inputs: ["minecraft:oak_planks"],
        outputs: ["minecraft:wooden_button"],
        type: "shaped",
        pattern: ["#"],
        key: { "#": "minecraft:oak_planks" },
      },
      {
        id: "minecraft:stick",
        stations: ["minecraft:crafting_table"],
        inputs: ["minecraft:bamboo"],
        outputs: ["minecraft:stick"],
        type: "shapeless",
      },
    ];
    const recipes = mergeRecipesJsonThenDump(json, dump);
    expect(recipes.map((row) => row.id)).toEqual(["minecraft:stick", "minecraft:wooden_button"]);
    expect(recipes[0]?.type).toBe("shaped");
  });
});

describe("mergeLootJsonThenDump", () => {
  it("keeps samples JSON and adds dump rows only for missing ids", () => {
    const json = [
      {
        id: "minecraft:blocks/red_shrub",
        block: "minecraft:red_shrub",
        entries: [{ item: "minecraft:red_shrub" }],
      },
    ];
    const dump = [
      {
        id: "minecraft:blocks/diamond_ore",
        block: "minecraft:diamond_ore",
        entries: [{ item: "minecraft:diamond" }],
      },
      {
        id: "minecraft:blocks/red_shrub",
        block: "minecraft:red_shrub",
        entries: [{ item: "minecraft:stick" }],
      },
    ];
    const loot = mergeLootJsonThenDump(json, dump);
    expect(loot.find((row) => row.block === "minecraft:red_shrub")?.entries).toEqual([
      { item: "minecraft:red_shrub" },
    ]);
    expect(loot.find((row) => row.block === "minecraft:diamond_ore")?.id).toBe("minecraft:blocks/diamond_ore/diamond");
    expect(loot.find((row) => row.block === "minecraft:diamond_ore")?.tools).toEqual(["none"]);
  });

  it("does not snapshot empty dump loot rows", () => {
    expect(
      mergeLootJsonThenDump([], [
        { id: "minecraft:blocks/air", block: "minecraft:air", entries: [] },
      ]),
    ).toEqual([]);
  });
});

describe("mergeGapBlockLoot", () => {
  it("unions harvest tokens that share entries onto one drop id", () => {
    expect(
      mergeGapBlockLoot([
        {
          id: "minecraft:blocks/diamond_ore/iron_pickaxe",
          block: "minecraft:diamond_ore",
          tools: ["minecraft:iron_pickaxe"],
          entries: [{ item: "minecraft:diamond" }],
        },
        {
          id: "minecraft:blocks/diamond_ore/diamond_pickaxe",
          block: "minecraft:diamond_ore",
          tools: ["minecraft:diamond_pickaxe"],
          entries: [{ item: "minecraft:diamond" }],
        },
      ]),
    ).toEqual([
      {
        id: "minecraft:blocks/diamond_ore/diamond",
        block: "minecraft:diamond_ore",
        tools: ["minecraft:diamond_pickaxe", "minecraft:iron_pickaxe"],
        entries: [{ item: "minecraft:diamond" }],
      },
    ]);
  });
});

describe("applyEngineTagDump", () => {
  it("does not replace tags for an id that has a samples JSON file", () => {
    const base = mergeTagMaps([new Map([["minecraft:oak_planks", new Set(["minecraft:planks"])]])]);
    const dump = { "minecraft:oak_planks": ["minecraft:wood"], "minecraft:dirt": ["minecraft:dirt"] };
    const merged = applyEngineTagDump(base, dump, new Set(["minecraft:oak_planks"]));
    expect(merged["minecraft:oak_planks"]).toEqual(["minecraft:planks"]);
    expect(merged["minecraft:dirt"]).toEqual(["minecraft:dirt"]);
  });
});
