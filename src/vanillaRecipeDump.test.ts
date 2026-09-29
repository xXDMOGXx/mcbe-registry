import { describe, expect, it } from "vitest";
import { matchingRecipes } from "./match.js";
import { VANILLA_RECIPES } from "./vanillaCatalog.js";
import { VANILLA_RECIPE_DUMP } from "./vanillaRecipeDump.js";
import { VANILLA_ITEM_TAGS } from "./vanillaProject.js";

describe("VANILLA_RECIPE_DUMP", () => {
  it("every dump recipe has a station, outputs, and a 3×3-or-smaller pattern when shaped", () => {
    for (const recipe of VANILLA_RECIPE_DUMP) {
      expect(recipe.stations.length).toBeGreaterThan(0);
      expect(recipe.outputs.length).toBeGreaterThan(0);
      if (recipe.type === "shaped") {
        expect(recipe.pattern).toBeDefined();
        expect(recipe.key).toBeDefined();
        expect(recipe.pattern!.length).toBeGreaterThanOrEqual(1);
        expect(recipe.pattern!.length).toBeLessThanOrEqual(3);
        for (const row of recipe.pattern!) expect(row.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("dump ids are unique", () => {
    const ids = VANILLA_RECIPE_DUMP.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("VANILLA_RECIPES engine-gap merge", () => {
  it("includes wooden_button from the dump", () => {
    expect(VANILLA_RECIPES.some((row) => row.id === "minecraft:wooden_button")).toBe(true);
  });

  it("matches a single oak plank to wooden_button", () => {
    const oak = "minecraft:oak_planks";
    const hit = matchingRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        grid: [oak, null, null, null, null, null, null, null, null],
      },
      VANILLA_ITEM_TAGS,
    )[0];
    expect(hit?.id).toBe("minecraft:wooden_button");
  });
});
