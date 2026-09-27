import type { Ingredient, Recipe } from "./protocol.js";

/** Vanilla recipe JSON `tags` value → station block id. Unknown tags are dropped. */
export const VANILLA_TAG_STATIONS: Readonly<Record<string, string>> = {
  crafting_table: "minecraft:crafting_table",
  stonecutter: "minecraft:stonecutter",
  furnace: "minecraft:furnace",
  blast_furnace: "minecraft:blast_furnace",
  smoker: "minecraft:smoker",
  campfire: "minecraft:campfire",
  soul_campfire: "minecraft:soul_campfire",
  smithing_table: "minecraft:smithing_table",
  brewing_stand: "minecraft:brewing_stand",
};

/** Container items whose remainder is a known empty vessel. */
export const VANILLA_REMAINDERS: Readonly<Record<string, string>> = {
  "minecraft:milk_bucket": "minecraft:bucket",
  "minecraft:water_bucket": "minecraft:bucket",
  "minecraft:lava_bucket": "minecraft:bucket",
  "minecraft:powder_snow_bucket": "minecraft:bucket",
  "minecraft:cod_bucket": "minecraft:bucket",
  "minecraft:salmon_bucket": "minecraft:bucket",
  "minecraft:tropical_fish_bucket": "minecraft:bucket",
  "minecraft:pufferfish_bucket": "minecraft:bucket",
  "minecraft:axolotl_bucket": "minecraft:bucket",
  "minecraft:tadpole_bucket": "minecraft:bucket",
  "minecraft:honey_bottle": "minecraft:glass_bottle",
};

/** Vanilla item ids that carry item tags (v1 match has no ItemStack). Regenerated with the catalog. */
export { VANILLA_ITEM_TAGS } from "./vanillaItemTags.js";

function qualifyMinecraft(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps legacy `minecraft:bucket` + `data` onto milk/empty bucket ids. */
function qualifyItemRef(value: unknown): string | undefined {
  if (typeof value === "string") return qualifyMinecraft(value);
  if (!isPlainObject(value) || typeof value.item !== "string") return undefined;
  const item = qualifyMinecraft(value.item);
  if (item === "minecraft:bucket" && value.data === 1) return "minecraft:milk_bucket";
  if (item === "minecraft:bucket" && value.data === 0) return "minecraft:bucket";
  return item;
}

function asIngredient(value: unknown): Ingredient | undefined {
  if (typeof value === "string") return qualifyMinecraft(value);
  if (!isPlainObject(value)) return undefined;
  if (typeof value.tag === "string") {
    const ingredient: Ingredient = { tag: value.tag };
    if (typeof value.count === "number" && value.count !== 1) ingredient.count = value.count;
    return ingredient;
  }
  const item = qualifyItemRef(value);
  if (item === undefined) return undefined;
  const count = typeof value.count === "number" ? value.count : 1;
  if (count === 1) return item;
  return { item, count };
}

function asIngredientList(value: unknown): Ingredient[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    const out: Ingredient[] = [];
    for (const entry of value) {
      const ingredient = asIngredient(entry);
      if (ingredient !== undefined) out.push(ingredient);
    }
    return out;
  }
  const single = asIngredient(value);
  return single === undefined ? [] : [single];
}

function stationsFromTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const stations: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const station = VANILLA_TAG_STATIONS[tag];
    if (station !== undefined) stations.push(station);
  }
  return stations;
}

function leftoverFromInputs(inputs: Ingredient[]): Ingredient | undefined {
  const counts = new Map<string, number>();
  for (const ingredient of inputs) {
    const item = typeof ingredient === "string" ? ingredient : ingredient.item;
    if (item === undefined) continue;
    const remainder = VANILLA_REMAINDERS[item];
    if (remainder === undefined) continue;
    const add = typeof ingredient === "string" ? 1 : (ingredient.count ?? 1);
    counts.set(remainder, (counts.get(remainder) ?? 0) + add);
  }
  if (counts.size !== 1) return undefined;
  const [item, count] = [...counts.entries()][0]!;
  return count === 1 ? item : { item, count };
}

function inputsFromPattern(pattern: string[], key: Record<string, Ingredient>): Ingredient[] {
  const counts = new Map<string, { ingredient: Ingredient; count: number }>();
  for (const row of pattern) {
    for (const symbol of row) {
      if (symbol === " ") continue;
      const ingredient = key[symbol];
      if (ingredient === undefined) continue;
      const id =
        typeof ingredient === "string"
          ? ingredient
          : (ingredient.item ?? ingredient.tag ?? symbol);
      const entry = counts.get(id);
      if (entry) entry.count += 1;
      else counts.set(id, { ingredient, count: 1 });
    }
  }
  return [...counts.values()].map(({ ingredient, count }) => {
    if (count === 1) return ingredient;
    if (typeof ingredient === "string") return { item: ingredient, count };
    return { ...ingredient, count: (ingredient.count ?? 1) * count };
  });
}

function projectKey(raw: unknown): Record<string, Ingredient> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const key: Record<string, Ingredient> = {};
  for (const [symbol, value] of Object.entries(raw)) {
    const ingredient = asIngredient(value);
    if (ingredient !== undefined) key[symbol] = ingredient;
  }
  return Object.keys(key).length > 0 ? key : undefined;
}

function withLeftover(recipe: Recipe, leftover: Ingredient | undefined): Recipe {
  if (leftover === undefined || recipe.leftover !== undefined) return recipe;
  return { ...recipe, leftover };
}

function typeForStations(kind: string, stations: string[]): string {
  if (kind === "shaped") return "shaped";
  if (kind === "shapeless") return stations.includes("minecraft:stonecutter") ? "cut" : "shapeless";
  if (kind === "furnace") return "smelt";
  if (kind === "brewing_mix") return "brew_mix";
  if (kind === "brewing_container") return "brew_container";
  if (kind === "smithing_transform") return "smith_transform";
  if (kind === "smithing_trim") return "smith_trim";
  return kind;
}

/**
 * Projects one Mojang recipe JSON object onto a generic Recipe document.
 * Unknown kinds and recipes with no mapped stations are skipped.
 */
export function projectVanillaJson(json: unknown): Recipe | undefined {
  if (!isPlainObject(json)) return undefined;

  const shaped = json["minecraft:recipe_shaped"];
  if (isPlainObject(shaped)) {
    const id = isPlainObject(shaped.description) && typeof shaped.description.identifier === "string"
      ? shaped.description.identifier
      : undefined;
    const stations = stationsFromTags(shaped.tags);
    const pattern = Array.isArray(shaped.pattern) ? shaped.pattern.filter((row): row is string => typeof row === "string") : [];
    const key = projectKey(shaped.key);
    if (id === undefined || stations.length === 0 || pattern.length === 0 || key === undefined) return undefined;
    const resultList = asIngredientList(shaped.result);
    if (resultList.length === 0) return undefined;
    const inputs = inputsFromPattern(pattern, key);
    const leftover = resultList.length > 1 ? resultList[1] : leftoverFromInputs(inputs);
    return withLeftover(
      {
        id,
        stations,
        inputs,
        outputs: [resultList[0]!],
        type: typeForStations("shaped", stations),
        pattern,
        key,
        ...(typeof shaped.priority === "number" ? { priority: shaped.priority } : {}),
      },
      leftover,
    );
  }

  const shapeless = json["minecraft:recipe_shapeless"];
  if (isPlainObject(shapeless)) {
    const id = isPlainObject(shapeless.description) && typeof shapeless.description.identifier === "string"
      ? shapeless.description.identifier
      : undefined;
    const stations = stationsFromTags(shapeless.tags);
    const inputs = asIngredientList(shapeless.ingredients);
    const outputs = asIngredientList(shapeless.result);
    if (id === undefined || stations.length === 0 || inputs.length === 0 || outputs.length === 0) return undefined;
    return withLeftover(
      {
        id,
        stations,
        inputs,
        outputs,
        type: typeForStations("shapeless", stations),
        ...(typeof shapeless.priority === "number" ? { priority: shapeless.priority } : {}),
      },
      leftoverFromInputs(inputs),
    );
  }

  const furnace = json["minecraft:recipe_furnace"];
  if (isPlainObject(furnace)) {
    const id = isPlainObject(furnace.description) && typeof furnace.description.identifier === "string"
      ? furnace.description.identifier
      : undefined;
    const stations = stationsFromTags(furnace.tags);
    const input = asIngredient(furnace.input);
    const output = asIngredient(furnace.output);
    if (id === undefined || stations.length === 0 || input === undefined || output === undefined) return undefined;
    return {
      id,
      stations,
      inputs: [input],
      outputs: [output],
      type: typeForStations("furnace", stations),
      ...(typeof furnace.priority === "number" ? { priority: furnace.priority } : {}),
    };
  }

  const brewMix = json["minecraft:recipe_brewing_mix"];
  if (isPlainObject(brewMix)) {
    const id = isPlainObject(brewMix.description) && typeof brewMix.description.identifier === "string"
      ? brewMix.description.identifier
      : undefined;
    const stations = stationsFromTags(brewMix.tags);
    const input = asIngredient(brewMix.input);
    const reagent = asIngredient(brewMix.reagent);
    const output = asIngredient(brewMix.output);
    if (id === undefined || stations.length === 0 || input === undefined || reagent === undefined || output === undefined) {
      return undefined;
    }
    return {
      id,
      stations,
      inputs: [
        typeof input === "string" ? { item: input, slot: "input" } : { ...input, slot: "input" },
        typeof reagent === "string" ? { item: reagent, slot: "reagent" } : { ...reagent, slot: "reagent" },
      ],
      outputs: [output],
      type: typeForStations("brewing_mix", stations),
    };
  }

  const brewContainer = json["minecraft:recipe_brewing_container"];
  if (isPlainObject(brewContainer)) {
    const id = isPlainObject(brewContainer.description) && typeof brewContainer.description.identifier === "string"
      ? brewContainer.description.identifier
      : undefined;
    const stations = stationsFromTags(brewContainer.tags);
    const input = asIngredient(brewContainer.input);
    const reagent = asIngredient(brewContainer.reagent);
    const output = asIngredient(brewContainer.output);
    if (id === undefined || stations.length === 0 || input === undefined || reagent === undefined || output === undefined) {
      return undefined;
    }
    return {
      id,
      stations,
      inputs: [
        typeof input === "string" ? { item: input, slot: "input" } : { ...input, slot: "input" },
        typeof reagent === "string" ? { item: reagent, slot: "reagent" } : { ...reagent, slot: "reagent" },
      ],
      outputs: [output],
      type: typeForStations("brewing_container", stations),
    };
  }

  const smithTransform = json["minecraft:recipe_smithing_transform"];
  if (isPlainObject(smithTransform)) {
    const id = isPlainObject(smithTransform.description) && typeof smithTransform.description.identifier === "string"
      ? smithTransform.description.identifier
      : undefined;
    const stations = stationsFromTags(smithTransform.tags);
    const template = asIngredient(smithTransform.template);
    const base = asIngredient(smithTransform.base);
    const addition = asIngredient(smithTransform.addition);
    const result = asIngredient(smithTransform.result);
    if (
      id === undefined ||
      stations.length === 0 ||
      template === undefined ||
      base === undefined ||
      addition === undefined ||
      result === undefined
    ) {
      return undefined;
    }
    return {
      id,
      stations,
      inputs: [
        typeof template === "string" ? { item: template, slot: "template" } : { ...template, slot: "template" },
        typeof base === "string" ? { item: base, slot: "base" } : { ...base, slot: "base" },
        typeof addition === "string" ? { item: addition, slot: "addition" } : { ...addition, slot: "addition" },
      ],
      outputs: [result],
      type: typeForStations("smithing_transform", stations),
    };
  }

  const smithTrim = json["minecraft:recipe_smithing_trim"];
  if (isPlainObject(smithTrim)) {
    const id = isPlainObject(smithTrim.description) && typeof smithTrim.description.identifier === "string"
      ? smithTrim.description.identifier
      : undefined;
    const stations = stationsFromTags(smithTrim.tags);
    const template = asIngredient(smithTrim.template);
    const base = asIngredient(smithTrim.base);
    const addition = asIngredient(smithTrim.addition);
    if (id === undefined || stations.length === 0 || template === undefined || base === undefined || addition === undefined) {
      return undefined;
    }
    const result = asIngredient(smithTrim.result) ?? base;
    return {
      id,
      stations,
      inputs: [
        typeof template === "string" ? { item: template, slot: "template" } : { ...template, slot: "template" },
        typeof base === "string" ? { item: base, slot: "base" } : { ...base, slot: "base" },
        typeof addition === "string" ? { item: addition, slot: "addition" } : { ...addition, slot: "addition" },
      ],
      outputs: [result],
      type: typeForStations("smithing_trim", stations),
    };
  }

  return undefined;
}
