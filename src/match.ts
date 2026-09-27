import { stringifyEnvelope, toMatchResult } from "./compactJson.js";
import type { Ingredient, IngredientObject, MatchQuery, MatchResult, Recipe } from "./protocol.js";

/** Item id → tag ids that item is known to have (vendored vanilla tags, plus query-side `tags`). */
export type TagIndex = Readonly<Record<string, readonly string[]>>;

interface ResolvedIngredient {
  item?: string;
  tag?: string;
  slot?: string;
  tags?: string[];
}

function asObject(ingredient: Ingredient): IngredientObject {
  return typeof ingredient === "string" ? { item: ingredient } : ingredient;
}

function expand(ingredients: readonly Ingredient[]): ResolvedIngredient[] {
  const out: ResolvedIngredient[] = [];
  for (const ingredient of ingredients) {
    const obj = asObject(ingredient);
    const count = obj.count ?? 1;
    for (let i = 0; i < count; i++) {
      out.push({ item: obj.item, tag: obj.tag, slot: obj.slot, tags: obj.tags });
    }
  }
  return out;
}

function itemHasTag(itemId: string, tag: string, queryTags: string[] | undefined, tagIndex: TagIndex | undefined): boolean {
  if (queryTags?.includes(tag)) return true;
  return tagIndex?.[itemId]?.includes(tag) === true;
}

function occupiedGrid(grid: (string | null)[]): Ingredient[] {
  const inputs: Ingredient[] = [];
  for (const cell of grid) {
    if (cell) inputs.push(cell);
  }
  return inputs;
}

function ingredientItemId(ingredient: Ingredient): string | undefined {
  return typeof ingredient === "string" ? ingredient : ingredient.item;
}

/** Expands vanilla `pattern`+`key` into a top-left-aligned 9-cell grid of item ids. */
function expandPatternKeyToGrid(
  pattern: string[],
  key: Record<string, Ingredient>,
): (string | null)[] | undefined {
  const height = pattern.length;
  const width = patternWidth(pattern);
  if (height < 1 || height > 3 || width < 1 || width > 3) return undefined;
  const grid: (string | null)[] = [null, null, null, null, null, null, null, null, null];
  for (let row = 0; row < height; row++) {
    const line = pattern[row]!.padEnd(width, " ");
    for (let col = 0; col < width; col++) {
      const symbol = line[col] ?? " ";
      if (symbol === " ") continue;
      const ingredient = key[symbol];
      if (ingredient === undefined) return undefined;
      const item = ingredientItemId(ingredient);
      if (item === undefined) return undefined;
      grid[row * 3 + col] = item;
    }
  }
  return grid;
}

/** Query `grid` if present; otherwise a 9-cell expansion of query `pattern`+`key`. */
function resolvedGrid(query: MatchQuery): (string | null)[] | undefined {
  if (query.grid !== undefined) return query.grid;
  if (query.pattern !== undefined && query.key !== undefined) {
    return expandPatternKeyToGrid(query.pattern, query.key);
  }
  return undefined;
}

function isEmptyQuery(query: MatchQuery): boolean {
  const gridOccupied = resolvedGrid(query)?.some((cell) => cell) === true;
  const inputsOccupied = query.inputs !== undefined && query.inputs.length > 0;
  return !gridOccupied && !inputsOccupied;
}

/** Item posting token; recipes that name this type-id. */
export function itemPostingToken(itemId: string): string {
  return `i:${itemId}`;
}

/** Tag posting token; recipes that name this tag. Members are not exploded. */
export function tagPostingToken(tag: string): string {
  return `t:${tag}`;
}

/** Composite posting key: station, occupied/fill count, item or tag token. */
export function postingKey(station: string, count: number, token: string): string {
  return `${station}\0${count}\0${token}`;
}

function patternFillCount(pattern: string[]): number {
  let n = 0;
  for (const row of pattern) {
    for (const ch of row) {
      if (ch !== " ") n += 1;
    }
  }
  return n;
}

/** Partition count: non-space pattern cells when shaped, otherwise expanded `inputs` length. */
export function recipeMatchCount(recipe: Recipe): number {
  if (recipe.pattern !== undefined && recipe.key !== undefined) return patternFillCount(recipe.pattern);
  return expand(recipe.inputs).length;
}

/** Partition count: occupied grid cells, or expanded `inputs` when the query has no grid. */
export function queryMatchCount(query: MatchQuery): number {
  if (isEmptyQuery(query)) return 0;
  const grid = resolvedGrid(query);
  if (grid !== undefined) return occupiedGrid(grid).length;
  return expand(query.inputs ?? []).length;
}

/** Unique `i:` / `t:` tokens from `inputs` and `key` (no tag-member explosion). */
export function recipePostingTokens(recipe: Recipe): string[] {
  const tokens = new Set<string>();
  const visit = (ingredient: Ingredient): void => {
    const obj = asObject(ingredient);
    if (obj.item !== undefined) tokens.add(itemPostingToken(obj.item));
    if (obj.tag !== undefined) tokens.add(tagPostingToken(obj.tag));
  };
  for (const ingredient of recipe.inputs) visit(ingredient);
  if (recipe.key !== undefined) {
    for (const ingredient of Object.values(recipe.key)) visit(ingredient);
  }
  return [...tokens];
}

/**
 * Per unique query item (or tag-only ingredient), posting tokens to union.
 * Snapshot tags are included only when `tagIndexed` is true; query-side `tags` always are.
 */
export function queryPostingClauses(
  query: MatchQuery,
  tagIndex: TagIndex | undefined,
  tagIndexed: (tag: string) => boolean,
): string[][] {
  const byItem = new Map<string, Set<string>>();
  const tagOnly = new Set<string>();

  const addItem = (itemId: string, extraTags: readonly string[] | undefined): void => {
    let tags = byItem.get(itemId);
    if (tags === undefined) {
      tags = new Set();
      byItem.set(itemId, tags);
    }
    if (extraTags !== undefined) {
      for (const tag of extraTags) tags.add(tag);
    }
  };

  const grid = resolvedGrid(query);
  if (grid !== undefined) {
    for (const cell of grid) {
      if (cell) addItem(cell, undefined);
    }
  } else if (query.inputs !== undefined) {
    for (const ingredient of query.inputs) {
      const obj = asObject(ingredient);
      if (obj.item !== undefined) addItem(obj.item, obj.tags);
      else if (obj.tag !== undefined) tagOnly.add(obj.tag);
    }
  }

  const clauses: string[][] = [];
  for (const [itemId, extraTags] of byItem) {
    const tokens = [itemPostingToken(itemId)];
    const snapshot = tagIndex?.[itemId];
    if (snapshot !== undefined) {
      for (const tag of snapshot) {
        if (tagIndexed(tag)) tokens.push(tagPostingToken(tag));
      }
    }
    for (const tag of extraTags) tokens.push(tagPostingToken(tag));
    clauses.push(tokens);
  }
  for (const tag of tagOnly) clauses.push([tagPostingToken(tag)]);
  return clauses;
}

function matchesNeed(need: ResolvedIngredient, have: ResolvedIngredient, tagIndex: TagIndex | undefined): boolean {
  if (need.slot !== undefined && have.slot !== undefined && need.slot !== have.slot) return false;
  if (need.tag !== undefined) {
    if (have.tag === need.tag) return true;
    if (have.item !== undefined && itemHasTag(have.item, need.tag, have.tags, tagIndex)) return true;
    return false;
  }
  if (need.item !== undefined) return have.item === need.item;
  return false;
}

function bagMatch(needList: ResolvedIngredient[], haveList: ResolvedIngredient[], tagIndex: TagIndex | undefined): boolean {
  if (needList.length !== haveList.length) return false;
  const used = new Array<boolean>(haveList.length).fill(false);
  for (const need of needList) {
    let found = false;
    for (let i = 0; i < haveList.length; i++) {
      if (used[i]) continue;
      if (!matchesNeed(need, haveList[i]!, tagIndex)) continue;
      used[i] = true;
      found = true;
      break;
    }
    if (!found) return false;
  }
  return true;
}

function gridCell(grid: (string | null)[], row: number, col: number): string | null {
  return grid[row * 3 + col] ?? null;
}

function patternWidth(pattern: string[]): number {
  let width = 0;
  for (const row of pattern) width = Math.max(width, row.length);
  return width;
}

function mirroredPattern(pattern: string[]): string[] {
  const width = patternWidth(pattern);
  return pattern.map((row) => row.padEnd(width, " ").split("").reverse().join(""));
}

function keyIngredient(recipe: Recipe, symbol: string): Ingredient | undefined {
  return recipe.key?.[symbol];
}

function cellMatchesIngredient(
  cell: string | null,
  ingredient: Ingredient,
  tagIndex: TagIndex | undefined,
): boolean {
  if (!cell) return false;
  const need = asObject(ingredient);
  const have: ResolvedIngredient = { item: cell, tags: tagIndex?.[cell] ? [...tagIndex[cell]!] : undefined };
  return matchesNeed({ item: need.item, tag: need.tag }, have, tagIndex);
}

function shapedFits(
  recipe: Recipe,
  grid: (string | null)[],
  pattern: string[],
  tagIndex: TagIndex | undefined,
): boolean {
  const height = pattern.length;
  const width = patternWidth(pattern);
  if (height < 1 || height > 3 || width < 1 || width > 3) return false;
  for (let oy = 0; oy <= 3 - height; oy++) {
    for (let ox = 0; ox <= 3 - width; ox++) {
      let ok = true;
      for (let row = 0; row < 3 && ok; row++) {
        for (let col = 0; col < 3; col++) {
          const cell = gridCell(grid, row, col);
          const pr = row - oy;
          const pc = col - ox;
          const inside = pr >= 0 && pr < height && pc >= 0 && pc < width;
          const symbol = inside ? (pattern[pr]!.padEnd(width, " ")[pc] ?? " ") : " ";
          if (symbol === " ") {
            if (cell) {
              ok = false;
              break;
            }
            continue;
          }
          const ingredient = keyIngredient(recipe, symbol);
          if (ingredient === undefined || !cellMatchesIngredient(cell, ingredient, tagIndex)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

/**
 * True when `recipe` matches `query` at `query.station` (shaped translate+mirror or bag).
 */
export function recipeMatches(recipe: Recipe, query: MatchQuery, tagIndex: TagIndex | undefined): boolean {
  if (!recipe.stations.includes(query.station)) return false;
  const grid = resolvedGrid(query);
  const hasPattern = recipe.pattern !== undefined && recipe.key !== undefined && grid !== undefined;
  if (hasPattern) {
    if (grid!.length !== 9) return false;
    if (shapedFits(recipe, grid!, recipe.pattern!, tagIndex)) return true;
    return shapedFits(recipe, grid!, mirroredPattern(recipe.pattern!), tagIndex);
  }
  const queryIngredients =
    query.inputs !== undefined && query.inputs.length > 0
      ? query.inputs
      : grid !== undefined
        ? occupiedGrid(grid)
        : [];
  return bagMatch(expand(recipe.inputs), expand(queryIngredients), tagIndex);
}

function priorityOf(recipe: Recipe): number {
  return recipe.priority ?? 0;
}

/**
 * Every matching recipe at `query.station`, highest `priority` then first registered.
 * Shaped translate+mirror when both sides have a grid/pattern (query `grid`, or query `pattern`+`key`
 * expanded to a grid); otherwise bag-match. Empty grid/inputs yield no hits.
 */
export function matchingRecipes(
  recipes: readonly Recipe[],
  query: MatchQuery,
  tagIndex?: TagIndex,
): Recipe[] {
  if (isEmptyQuery(query)) return [];
  const hits: { recipe: Recipe; index: number }[] = [];
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]!;
    if (!recipeMatches(recipe, query, tagIndex)) continue;
    hits.push({ recipe, index: i });
  }
  hits.sort((a, b) => {
    const byPriority = priorityOf(b.recipe) - priorityOf(a.recipe);
    if (byPriority !== 0) return byPriority;
    return a.index - b.index;
  });
  return hits.map((hit) => hit.recipe);
}

/** Matching recipe ids in {@link matchingRecipes} order. Not grouped by yield. */
export function matchRecipeIds(
  recipes: readonly Recipe[],
  query: MatchQuery,
  tagIndex?: TagIndex,
): string[] {
  return matchingRecipes(recipes, query, tagIndex).map((recipe) => recipe.id);
}

/** Compact outputs + leftover identity for grouping {@link matchRecipeResults}. */
function yieldKey(recipe: Recipe): string {
  const result = toMatchResult(recipe);
  return stringifyEnvelope({ outputs: result.outputs, leftover: result.leftover });
}

/** Distinct yields from already-ordered matching recipes; one row per compact `outputs`+`leftover`. */
export function groupRecipeYields(recipes: readonly Recipe[]): MatchResult[] {
  const seen = new Set<string>();
  const out: MatchResult[] = [];
  for (const recipe of recipes) {
    const key = yieldKey(recipe);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toMatchResult(recipe));
  }
  return out;
}

/**
 * Distinct yields for a match query: one {@link MatchResult} per compact `outputs`+`leftover`.
 * Order follows the winning recipe in each group. No `id`.
 */
export function matchRecipeResults(
  recipes: readonly Recipe[],
  query: MatchQuery,
  tagIndex?: TagIndex,
): MatchResult[] {
  return groupRecipeYields(matchingRecipes(recipes, query, tagIndex));
}
