import type { Ingredient, IngredientObject, MatchResult, Recipe } from "./protocol.js";

const RECIPE_KNOWN = new Set([
  "id",
  "stations",
  "inputs",
  "outputs",
  "type",
  "pattern",
  "key",
  "leftover",
  "priority",
  "duration",
  "energy",
  "extra",
]);

/** True when `value` is a non-null object (not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compact ingredient: type-id string when count is 1 and there is no tag/slot. */
export function compactIngredient(ingredient: Ingredient): Ingredient {
  if (typeof ingredient === "string") return ingredient;
  const count = ingredient.count ?? 1;
  const hasTag = ingredient.tag !== undefined;
  const hasSlot = ingredient.slot !== undefined;
  const hasTags = ingredient.tags !== undefined && ingredient.tags.length > 0;
  if (ingredient.item !== undefined && !hasTag && !hasSlot && !hasTags && count === 1) {
    return ingredient.item;
  }
  const out: IngredientObject = {};
  if (ingredient.item !== undefined) out.item = ingredient.item;
  if (hasTag) out.tag = ingredient.tag;
  if (count !== 1) out.count = count;
  if (hasSlot) out.slot = ingredient.slot;
  if (hasTags) out.tags = ingredient.tags;
  return out;
}

/** Compact recipe document: omit absent optionals, never emit null/zero duration or energy. */
export function compactRecipe(recipe: Recipe): Recipe {
  const out: Recipe = {
    id: recipe.id,
    stations: [...recipe.stations],
    inputs: recipe.inputs.map(compactIngredient),
    outputs: recipe.outputs.map(compactIngredient),
  };
  if (recipe.type !== undefined) out.type = recipe.type;
  if (recipe.pattern !== undefined) out.pattern = [...recipe.pattern];
  if (recipe.key !== undefined) {
    const key: Record<string, Ingredient> = {};
    for (const [symbol, ingredient] of Object.entries(recipe.key)) {
      key[symbol] = compactIngredient(ingredient);
    }
    out.key = key;
  }
  if (recipe.leftover !== undefined) out.leftover = compactIngredient(recipe.leftover);
  if (recipe.priority !== undefined) out.priority = recipe.priority;
  if (recipe.duration !== undefined && recipe.duration >= 1) out.duration = recipe.duration;
  if (recipe.energy !== undefined) out.energy = recipe.energy;
  if (recipe.extra !== undefined && Object.keys(recipe.extra).length > 0) out.extra = recipe.extra;
  for (const [key, value] of Object.entries(recipe)) {
    if (RECIPE_KNOWN.has(key) || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Yield DTO: `outputs` plus optional leftover/duration/energy/extra/type; drops `id` and stored inputs/pattern/key/stations/priority/unknown keys. */
export function toMatchResult(recipe: Recipe): MatchResult {
  const out: MatchResult = {
    outputs: recipe.outputs.map(compactIngredient),
  };
  if (recipe.type !== undefined) out.type = recipe.type;
  if (recipe.leftover !== undefined) out.leftover = compactIngredient(recipe.leftover);
  if (recipe.duration !== undefined && recipe.duration >= 1) out.duration = recipe.duration;
  if (recipe.energy !== undefined) out.energy = recipe.energy;
  if (recipe.extra !== undefined && Object.keys(recipe.extra).length > 0) out.extra = recipe.extra;
  return out;
}

/** Drops `undefined` (and `null`) values from a plain object before `JSON.stringify`. */
function stripEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmpty);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null) continue;
    out[key] = stripEmpty(child);
  }
  return out;
}

/** Compact JSON for a script-event body: no whitespace, no null/undefined fields. */
export function stringifyEnvelope(value: unknown): string {
  return JSON.stringify(stripEmpty(value));
}
