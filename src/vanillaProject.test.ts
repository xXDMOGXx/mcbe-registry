import { describe, expect, it } from "vitest";
import { projectVanillaJson, VANILLA_REMAINDERS, VANILLA_TAG_STATIONS } from "./vanillaProject.js";

describe("vanillaProject", () => {
  it("maps crafting_table tags to minecraft:crafting_table", () => {
    expect(VANILLA_TAG_STATIONS.crafting_table).toBe("minecraft:crafting_table");
  });

  it("maps milk_bucket remainder to bucket", () => {
    expect(VANILLA_REMAINDERS["minecraft:milk_bucket"]).toBe("minecraft:bucket");
  });

  it("drops unknown tags and skips recipes with no mapped stations", () => {
    expect(
      projectVanillaJson({
        "minecraft:recipe_shapeless": {
          description: { identifier: "minecraft:custom_table" },
          tags: ["some_addon_table"],
          ingredients: [{ item: "minecraft:stone" }],
          result: { item: "minecraft:cobblestone" },
        },
      }),
    ).toBeUndefined();
  });

  it("qualifies bare result ids as minecraft:", () => {
    const recipe = projectVanillaJson({
      "minecraft:recipe_shaped": {
        description: { identifier: "minecraft:stick" },
        tags: ["crafting_table"],
        pattern: ["A", "A"],
        key: { A: { tag: "minecraft:planks" } },
        result: { item: "stick", count: 4 },
      },
    });
    expect(recipe?.outputs).toEqual([{ item: "minecraft:stick", count: 4 }]);
  });
});
