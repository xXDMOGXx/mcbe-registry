import { describe, expect, it } from "vitest";
import { applyEngineTagDump, mergeGapBlockLoot, mergeLootJsonThenDump, mergeTagMaps } from "./vanillaSnapshotMerge.js";

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
