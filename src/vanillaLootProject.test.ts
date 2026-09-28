import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadVanillaLoot, loadVanillaLootJson, projectLootFile } from "./vanillaLootProject.js";

describe("projectLootFile", () => {
  it("inlines nested loot_table entries and sets block from the file stem", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbab-loot-"));
    const blocks = path.join(dir, "loot_tables", "blocks");
    fs.mkdirSync(blocks, { recursive: true });
    fs.writeFileSync(
      path.join(blocks, "nested.json"),
      JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:stick" }] }] }),
    );
    fs.writeFileSync(
      path.join(blocks, "parent.json"),
      JSON.stringify({
        pools: [{ rolls: 1, entries: [{ type: "loot_table", name: "loot_tables/blocks/nested.json" }] }],
      }),
    );
    const projected = projectLootFile(path.join(blocks, "parent.json"), "blocks", dir);
    expect(projected).toEqual({
      id: "minecraft:blocks/parent",
      block: "minecraft:parent",
      entries: [{ item: "minecraft:stick" }],
    });
  });
});

describe("loadVanillaLoot", () => {
  it("keeps samples file tables and merges dump only for missing ids", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbab-loot-load-"));
    const blocks = path.join(dir, "loot_tables", "blocks");
    fs.mkdirSync(blocks, { recursive: true });
    fs.writeFileSync(
      path.join(blocks, "red_shrub.json"),
      JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:red_shrub" }] }] }),
    );
    const json = loadVanillaLootJson(dir);
    expect(json.some((row) => row.block === "minecraft:red_shrub")).toBe(true);
    expect(json.some((row) => row.block === "minecraft:diamond_ore")).toBe(false);
    const loot = loadVanillaLoot(dir, [
      {
        id: "minecraft:blocks/diamond_ore",
        block: "minecraft:diamond_ore",
        entries: [{ item: "minecraft:diamond" }],
      },
    ]);
    expect(loot.find((row) => row.block === "minecraft:red_shrub")?.entries).toEqual([{ item: "minecraft:red_shrub" }]);
    expect(loot.find((row) => row.block === "minecraft:diamond_ore")?.entries).toEqual([{ item: "minecraft:diamond" }]);
  });
});
