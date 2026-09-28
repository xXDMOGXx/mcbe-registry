import { describe, expect, it } from "vitest";
import { createCatalog } from "./catalog.js";
import { VANILLA_LOOT } from "./vanillaLoot.js";

describe("VANILLA_LOOT", () => {
  it("indexes creeper from samples JSON", () => {
    const catalog = createCatalog();
    for (const row of VANILLA_LOOT) catalog.registerDocument("loot", row);
    const creeper = catalog.listDocuments("loot", { entity: "minecraft:creeper" })[0];
    expect(creeper?.entries).toEqual(expect.arrayContaining([{ item: "minecraft:gunpowder" }]));
  });

  it("indexes diamond ore generate by iron pickaxe", () => {
    const catalog = createCatalog();
    for (const row of VANILLA_LOOT) catalog.registerDocument("loot", row);
    const rows = catalog.listDocuments("loot", { block: "minecraft:diamond_ore" });
    expect(
      rows.some(
        (row) =>
          row.tools?.includes("minecraft:iron_pickaxe") && row.entries.some((e) => e.item === "minecraft:diamond"),
      ),
    ).toBe(true);
    expect(
      catalog.listDocuments("loot", { tool: "minecraft:iron_pickaxe" }).some((row) => row.block === "minecraft:diamond_ore"),
    ).toBe(true);
  });
});
