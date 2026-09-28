import { describe, expect, it } from "vitest";
import { matchingRecipes, matchRecipeIds, matchRecipeResults, recipePostingTokens } from "./match.js";
import { projectVanillaJson, VANILLA_ITEM_TAGS } from "./vanillaProject.js";
import { VANILLA_RECIPES } from "./vanillaCatalog.js";
import type { Recipe } from "./protocol.js";

function grid(cells: (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [...cells];
  while (out.length < 9) out.push(null);
  return out.slice(0, 9);
}

const smokerOnly: Recipe = {
  id: "addon:smoker_only_kelp",
  stations: ["minecraft:smoker"],
  inputs: ["minecraft:kelp"],
  outputs: ["minecraft:dried_kelp"],
  type: "smelt",
};

function matchRecipes(
  recipes: readonly Recipe[],
  query: Parameters<typeof matchingRecipes>[1],
  tagIndex?: Parameters<typeof matchingRecipes>[2],
): Recipe | undefined {
  return matchingRecipes(recipes, query, tagIndex)[0];
}

describe("matchingRecipes", () => {
  it("matches two planks in a column via query pattern and key", () => {
    const hit = matchRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        pattern: ["A", "A"],
        key: { A: "minecraft:oak_planks" },
      },
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:stick");
  });

  it("matches a chest pattern via query pattern and key", () => {
    const hit = matchRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        pattern: ["AAA", "A A", "AAA"],
        key: { A: "minecraft:oak_planks" },
      },
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:Chest_recipeId");
  });

  it("matches two planks in a column to sticks", () => {
    const hit = matchRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        grid: grid(["minecraft:oak_planks", null, null, "minecraft:oak_planks"]),
      },
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:stick");
    expect(hit?.outputs).toEqual([{ item: "minecraft:stick", count: 4 }]);
  });

  it("matches a chest pattern using plank tags", () => {
    const oak = "minecraft:oak_planks";
    const hit = matchRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        grid: [oak, oak, oak, oak, null, oak, oak, oak, oak],
      },
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:Chest_recipeId");
  });

  it("matches a shaped recipe that is shifted in the 3x3 grid", () => {
    const hit = matchRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        grid: grid([null, "minecraft:oak_planks", null, null, "minecraft:oak_planks"]),
      },
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:stick");
  });

  it("matches a horizontally mirrored stick column", () => {
    const hit = matchRecipes(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        grid: grid([null, null, "minecraft:birch_planks", null, null, "minecraft:birch_planks"]),
      },
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:stick");
  });

  it("matches beef in a furnace and not raw iron in a smoker", () => {
    expect(
      matchRecipes(VANILLA_RECIPES, { station: "minecraft:furnace", inputs: ["minecraft:beef"] })?.outputs,
    ).toEqual(["minecraft:cooked_beef"]);
    expect(matchRecipes(VANILLA_RECIPES, { station: "minecraft:smoker", inputs: ["minecraft:raw_iron"] })).toBeUndefined();
  });

  it("does not match a smoker-only recipe at a furnace", () => {
    expect(matchRecipes([smokerOnly], { station: "minecraft:furnace", inputs: ["minecraft:kelp"] })).toBeUndefined();
    expect(matchRecipes([smokerOnly], { station: "minecraft:smoker", inputs: ["minecraft:kelp"] })?.id).toBe(
      "addon:smoker_only_kelp",
    );
  });

  it("matches the highest-priority stonecutter cut for andesite", () => {
    expect(
      matchRecipes(VANILLA_RECIPES, {
        station: "minecraft:stonecutter",
        inputs: ["minecraft:andesite"],
      })?.outputs,
    ).toEqual(["minecraft:polished_andesite_stairs"]);
  });

  it("matches smithing transform using named slots", () => {
    const hit = matchRecipes(VANILLA_RECIPES, {
      station: "minecraft:smithing_table",
      inputs: [
        { item: "minecraft:netherite_upgrade_smithing_template", slot: "template" },
        { item: "minecraft:diamond_boots", slot: "base" },
        { item: "minecraft:netherite_ingot", slot: "addition" },
      ],
    });
    expect(hit?.outputs).toEqual(["minecraft:netherite_boots"]);
  });

  it("matches brewing mix vs brewing container", () => {
    expect(
      matchRecipes(VANILLA_RECIPES, {
        station: "minecraft:brewing_stand",
        inputs: [
          { item: "minecraft:potion_type:awkward", slot: "input" },
          { item: "minecraft:blaze_powder", slot: "reagent" },
        ],
      })?.id,
    ).toBe("minecraft:brew_awkward_blaze_powder");
    expect(
      matchRecipes(VANILLA_RECIPES, {
        station: "minecraft:brewing_stand",
        inputs: [
          { item: "minecraft:potion", slot: "input" },
          { item: "minecraft:gunpowder", slot: "reagent" },
        ],
      })?.id,
    ).toBe("minecraft:brew_potion_sulphur");
  });

  it("returns no match for an empty grid", () => {
    expect(
      matchRecipes(VANILLA_RECIPES, {
        station: "minecraft:crafting_table",
        grid: [null, null, null, null, null, null, null, null, null],
      }),
    ).toBeUndefined();
  });

  it("prefers higher priority then first registered", () => {
    const low: Recipe = {
      id: "a:low",
      stations: ["s"],
      inputs: ["minecraft:stone"],
      outputs: ["minecraft:a"],
      priority: 1,
    };
    const high: Recipe = {
      id: "a:high",
      stations: ["s"],
      inputs: ["minecraft:stone"],
      outputs: ["minecraft:b"],
      priority: 5,
    };
    expect(matchRecipes([low, high], { station: "s", inputs: ["minecraft:stone"] })?.id).toBe("a:high");
    const first: Recipe = { id: "a:first", stations: ["s"], inputs: ["minecraft:stone"], outputs: ["minecraft:c"] };
    const second: Recipe = { id: "a:second", stations: ["s"], inputs: ["minecraft:stone"], outputs: ["minecraft:d"] };
    expect(matchRecipes([first, second], { station: "s", inputs: ["minecraft:stone"] })?.id).toBe("a:first");
  });

  it("bag-matches named slots only when both sides named them", () => {
    const recipe: Recipe = {
      id: "m:x",
      stations: ["m:m"],
      inputs: [{ item: "minecraft:raw_iron", slot: "in" }],
      outputs: ["minecraft:iron_ingot"],
    };
    expect(matchRecipes([recipe], { station: "m:m", inputs: ["minecraft:raw_iron"] })?.id).toBe("m:x");
    expect(
      matchRecipes([recipe], { station: "m:m", inputs: [{ item: "minecraft:raw_iron", slot: "out" }] }),
    ).toBeUndefined();
  });

  it("matches a fluid bag by id and amount, not the vessel item", () => {
    const recipe: Recipe = {
      id: "m:wet",
      stations: ["m:tank"],
      inputs: [{ fluid: "minecraft:water", amount: 3000 }],
      outputs: ["minecraft:wet_sponge"],
    };
    expect(
      matchRecipes([recipe], { station: "m:tank", inputs: [{ fluid: "minecraft:water", amount: 3000 }] })?.id,
    ).toBe("m:wet");
    expect(matchRecipes([recipe], { station: "m:tank", inputs: ["minecraft:water_bucket"] })).toBeUndefined();
    expect(
      matchRecipes([recipe], { station: "m:tank", inputs: [{ fluid: "minecraft:water", amount: 1000 }] }),
    ).toBeUndefined();
  });

  it("matches cake using a brown egg via the egg tag", () => {
    const hit = matchRecipes(
      VANILLA_RECIPES,
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
      VANILLA_ITEM_TAGS,
    );
    expect(hit?.id).toBe("minecraft:cake");
    expect(hit?.leftover).toEqual({ item: "minecraft:bucket", count: 3 });
  });
});

describe("matchRecipeIds", () => {
  it("returns every matching recipe id, not grouped by yield", () => {
    const same: Recipe[] = [
      {
        id: "addon:first",
        stations: ["s"],
        inputs: ["minecraft:stone"],
        outputs: ["minecraft:stick"],
      },
      {
        id: "addon:second",
        stations: ["s"],
        inputs: ["minecraft:stone"],
        outputs: ["minecraft:stick"],
        priority: 5,
      },
    ];
    expect(matchRecipeIds(same, { station: "s", inputs: ["minecraft:stone"] })).toEqual([
      "addon:second",
      "addon:first",
    ]);
  });

  it("returns only the oak stick recipe for an oak-plank column", () => {
    expect(
      matchRecipeIds(
        VANILLA_RECIPES,
        {
          station: "minecraft:crafting_table",
          pattern: ["A", "A"],
          key: { A: "minecraft:oak_planks" },
        },
        VANILLA_ITEM_TAGS,
      ),
    ).toEqual(["minecraft:stick"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(
      matchRecipeIds(VANILLA_RECIPES, { station: "minecraft:furnace", inputs: ["minecraft:stick"] }),
    ).toEqual([]);
  });
});

describe("matchRecipeResults", () => {
  it("groups the same compact outputs and leftover into one yield with no id", () => {
    const same: Recipe[] = [
      {
        id: "addon:first",
        stations: ["s"],
        inputs: ["minecraft:stone"],
        outputs: [{ item: "minecraft:stick", count: 4 }],
        type: "shaped",
      },
      {
        id: "addon:second",
        stations: ["s"],
        inputs: ["minecraft:stone"],
        outputs: [{ item: "minecraft:stick", count: 4 }],
        type: "shaped",
        priority: 5,
      },
    ];
    const results = matchRecipeResults(same, { station: "s", inputs: ["minecraft:stone"] });
    expect(results).toEqual([{ outputs: [{ item: "minecraft:stick", count: 4 }], type: "shaped" }]);
    expect(results[0]).not.toHaveProperty("id");
  });

  it("keeps distinct yields as separate rows in winner order", () => {
    const recipes: Recipe[] = [
      {
        id: "addon:low",
        stations: ["s"],
        inputs: ["minecraft:stone"],
        outputs: ["minecraft:a"],
        priority: 1,
      },
      {
        id: "addon:high",
        stations: ["s"],
        inputs: ["minecraft:stone"],
        outputs: ["minecraft:b"],
        priority: 5,
      },
    ];
    expect(matchRecipeResults(recipes, { station: "s", inputs: ["minecraft:stone"] })).toEqual([
      { outputs: ["minecraft:b"] },
      { outputs: ["minecraft:a"] },
    ]);
  });

  it("returns the stick yield without an id for an oak-plank column", () => {
    const results = matchRecipeResults(
      VANILLA_RECIPES,
      {
        station: "minecraft:crafting_table",
        pattern: ["A", "A"],
        key: { A: "minecraft:oak_planks" },
      },
      VANILLA_ITEM_TAGS,
    );
    expect(results).toEqual([{ outputs: [{ item: "minecraft:stick", count: 4 }], type: "shaped" }]);
    expect(results[0]).not.toHaveProperty("id");
  });

  it("returns an empty array when nothing matches", () => {
    expect(
      matchRecipeResults(VANILLA_RECIPES, { station: "minecraft:furnace", inputs: ["minecraft:stick"] }),
    ).toEqual([]);
  });
});

describe("recipePostingTokens", () => {
  it("indexes a plank tag once and does not explode members", () => {
    expect(
      recipePostingTokens({
        id: "minecraft:stick",
        stations: ["minecraft:crafting_table"],
        inputs: [{ tag: "minecraft:planks", count: 2 }],
        outputs: [{ item: "minecraft:stick", count: 4 }],
        pattern: ["A", "A"],
        key: { A: { tag: "minecraft:planks" } },
      }),
    ).toEqual(["t:minecraft:planks"]);
  });
});

describe("projectVanillaJson leftover", () => {
  it("copies extra vanilla result items onto leftover", () => {
    const cake = VANILLA_RECIPES.find((recipe) => recipe.id === "minecraft:cake");
    expect(cake?.leftover).toEqual({ item: "minecraft:bucket", count: 3 });
  });

  it("applies the remainder map when JSON has no leftover", () => {
    const recipe = projectVanillaJson({
      "minecraft:recipe_shapeless": {
        description: { identifier: "addon:milk_dump" },
        tags: ["crafting_table"],
        ingredients: [{ item: "minecraft:milk_bucket" }],
        result: { item: "minecraft:cake" },
      },
    });
    expect(recipe?.leftover).toBe("minecraft:bucket");
  });
});

describe("VANILLA_ITEM_TAGS", () => {
  it("maps oak planks and brown egg onto the tags recipes use", () => {
    expect(VANILLA_ITEM_TAGS["minecraft:oak_planks"]).toContain("minecraft:planks");
    expect(VANILLA_ITEM_TAGS["minecraft:brown_egg"]).toContain("minecraft:egg");
  });

  it("has at least one member for every tag used in the vanilla catalog", () => {
    const members = new Set<string>();
    for (const tags of Object.values(VANILLA_ITEM_TAGS)) {
      for (const tag of tags) members.add(tag);
    }
    const visit = (ingredient: Recipe["inputs"][number]): void => {
      if (typeof ingredient !== "string" && ingredient.tag !== undefined) {
        expect(members.has(ingredient.tag)).toBe(true);
      }
    };
    for (const recipe of VANILLA_RECIPES) {
      for (const ingredient of recipe.inputs) visit(ingredient);
      if (recipe.key !== undefined) {
        for (const ingredient of Object.values(recipe.key)) visit(ingredient);
      }
    }
  });
});
