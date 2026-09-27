import { compactIngredient, compactRecipe } from "./compactJson.js";
import {
  groupRecipeYields,
  postingKey,
  queryMatchCount,
  queryPostingClauses,
  recipeMatchCount,
  recipeMatches,
  recipePostingTokens,
  type TagIndex,
} from "./match.js";
import type { Ingredient, ListEntry, ListFilter, MatchQuery, MatchResult, Recipe } from "./protocol.js";
import { isValidSource } from "./sourceStore.js";

/** In-memory recipe store: replace-by-id, insertion-order ties, unknown keys preserved. */
export interface Catalog {
  /** Validates and stores `recipe`; replaces the same id in place. Optional `source` is the last-writer pack. Returns false when required fields are missing. */
  register(recipe: unknown, source?: string): boolean;
  /** Deletes `id`, or restores the vanilla backup when `id` was an overlay. Missing id is a no-op. */
  unregister(id: string): void;
  /** Copies the current catalog as the vanilla backup used by {@link dropSource}. */
  snapshotVanilla(): void;
  /** Drops every id owned by `source` and restores vanilla backups for overwritten ids. */
  dropSource(source: string): void;
  /** Replaces that source's documents. Returns other sources whose ids were overwritten. */
  replaceSource(source: string, recipes: readonly unknown[]): string[];
  /** Stored documents currently owned by `source`. */
  recipesForSource(source: string): Recipe[];
  /** Last-writer pack for `id`, or undefined when the id is vanilla or session-only. */
  sourceOf(id: string): string | undefined;
  /** Stored document for `id`, or undefined. */
  get(id: string): Recipe | undefined;
  /** All stored documents in registration order. */
  recipes(): Recipe[];
  /** Compact rows, optionally filtered by station and/or reverse output/leftover item id. */
  list(filter?: ListFilter): ListEntry[];
  /** Matching recipe ids via station/count/token postings, then {@link recipeMatches}. */
  matchIds(query: MatchQuery, tagIndex?: TagIndex): string[];
  /** Distinct yields for the same ask as {@link matchIds}. */
  matchResults(query: MatchQuery, tagIndex?: TagIndex): MatchResult[];
  /** Number of stored documents. */
  size(): number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIngredient(value: unknown): value is Ingredient {
  if (typeof value === "string") return value.length > 0;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.item === "string" || typeof obj.tag === "string";
}

function isRecipe(value: unknown): value is Recipe {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (!isNonEmptyString(obj.id)) return false;
  if (!Array.isArray(obj.stations) || obj.stations.length < 1 || !obj.stations.every(isNonEmptyString)) return false;
  if (!Array.isArray(obj.inputs) || !obj.inputs.every(isIngredient)) return false;
  if (!Array.isArray(obj.outputs) || !obj.outputs.every(isIngredient)) return false;
  return true;
}

function ingredientItemId(ingredient: Ingredient): string | undefined {
  return typeof ingredient === "string" ? ingredient : ingredient.item;
}

function addIndex(map: Map<string, Set<string>>, key: string, recipeId: string): void {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  set.add(recipeId);
}

function removeIndex(map: Map<string, Set<string>>, key: string, recipeId: string): void {
  const set = map.get(key);
  if (set === undefined) return;
  set.delete(recipeId);
  if (set.size === 0) map.delete(key);
}

function indexOutputs(recipe: Recipe, byOutput: Map<string, Set<string>>, byLeftover: Map<string, Set<string>>, add: boolean): void {
  const write = add ? addIndex : removeIndex;
  for (const output of recipe.outputs) {
    const item = ingredientItemId(output);
    if (item !== undefined) write(byOutput, item, recipe.id);
  }
  if (recipe.leftover !== undefined) {
    const item = ingredientItemId(recipe.leftover);
    if (item !== undefined) write(byLeftover, item, recipe.id);
  }
}

function toListEntry(recipe: Recipe): ListEntry {
  const entry: ListEntry = { id: recipe.id, stations: recipe.stations };
  if (recipe.type !== undefined) entry.type = recipe.type;
  if (recipe.leftover !== undefined) entry.leftover = compactIngredient(recipe.leftover);
  return entry;
}

function recipeTags(tokens: readonly string[]): string[] {
  const tags: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("t:")) tags.push(token.slice(2));
  }
  return tags;
}

function unionPostings(postings: Map<string, Set<string>>, station: string, count: number, tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    const set = postings.get(postingKey(station, count, token));
    if (set === undefined) continue;
    for (const id of set) out.add(id);
  }
  return out;
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  let smallest = sets[0]!;
  for (let i = 1; i < sets.length; i++) {
    if (sets[i]!.size < smallest.size) smallest = sets[i]!;
  }
  const out = new Set<string>();
  for (const id of smallest) {
    let ok = true;
    for (const set of sets) {
      if (set !== smallest && !set.has(id)) {
        ok = false;
        break;
      }
    }
    if (ok) out.add(id);
  }
  return out;
}

function priorityOf(recipe: Recipe): number {
  return recipe.priority ?? 0;
}

/** Empty catalog. Vanilla snapshot should be registered first so it wins equal-priority ties. */
export function createCatalog(): Catalog {
  const order: string[] = [];
  const seqById = new Map<string, number>();
  let nextSeq = 0;
  const byId = new Map<string, Recipe>();
  const byOutput = new Map<string, Set<string>>();
  const byLeftover = new Map<string, Set<string>>();
  const postings = new Map<string, Set<string>>();
  const tagRef = new Map<string, number>();
  const byStation = new Map<string, Set<string>>();
  const byStationOrder = new Map<string, string[]>();
  const vanillaById = new Map<string, Recipe>();
  const sourceOfId = new Map<string, string>();
  const idsBySource = new Map<string, Set<string>>();

  const addToStation = (station: string, id: string): void => {
    let set = byStation.get(station);
    if (set === undefined) {
      set = new Set();
      byStation.set(station, set);
      byStationOrder.set(station, []);
    }
    if (set.has(id)) return;
    set.add(id);
    byStationOrder.get(station)!.push(id);
  };

  const removeFromStation = (station: string, id: string): void => {
    const set = byStation.get(station);
    if (set === undefined || !set.delete(id)) return;
    const arr = byStationOrder.get(station)!;
    const index = arr.indexOf(id);
    if (index !== -1) arr.splice(index, 1);
    if (set.size === 0) {
      byStation.delete(station);
      byStationOrder.delete(station);
    }
  };

  const writeMatchIndex = (recipe: Recipe, add: boolean): void => {
    const count = recipeMatchCount(recipe);
    const tokens = recipePostingTokens(recipe);
    const write = add ? addIndex : removeIndex;
    for (const station of recipe.stations) {
      if (add) addToStation(station, recipe.id);
      else removeFromStation(station, recipe.id);
      for (const token of tokens) write(postings, postingKey(station, count, token), recipe.id);
    }
    const delta = add ? 1 : -1;
    for (const tag of recipeTags(tokens)) {
      const next = (tagRef.get(tag) ?? 0) + delta;
      if (next <= 0) tagRef.delete(tag);
      else tagRef.set(tag, next);
    }
  };

  const matchingHits = (query: MatchQuery, tagIndex: TagIndex | undefined): Recipe[] => {
    const count = queryMatchCount(query);
    if (count === 0) return [];
    const clauses = queryPostingClauses(query, tagIndex, (tag) => tagRef.has(tag));
    if (clauses.length === 0) return [];
    const unions: Set<string>[] = [];
    for (const tokens of clauses) {
      const union = unionPostings(postings, query.station, count, tokens);
      if (union.size === 0) return [];
      unions.push(union);
    }
    const candidates = intersectSets(unions);
    const hits: Recipe[] = [];
    for (const id of candidates) {
      const recipe = byId.get(id);
      if (recipe === undefined) continue;
      if (!recipeMatches(recipe, query, tagIndex)) continue;
      hits.push(recipe);
    }
    hits.sort((a, b) => {
      const byPriority = priorityOf(b) - priorityOf(a);
      if (byPriority !== 0) return byPriority;
      return (seqById.get(a.id) ?? 0) - (seqById.get(b.id) ?? 0);
    });
    return hits;
  };

  const detachSource = (id: string, source: string): void => {
    const set = idsBySource.get(source);
    if (set === undefined) return;
    set.delete(id);
    if (set.size === 0) idsBySource.delete(source);
  };

  const put = (stored: Recipe, source: string | undefined): void => {
    const previous = byId.get(stored.id);
    if (previous !== undefined) {
      indexOutputs(previous, byOutput, byLeftover, false);
      writeMatchIndex(previous, false);
      const prevSource = sourceOfId.get(stored.id);
      if (prevSource !== undefined && prevSource !== source) detachSource(stored.id, prevSource);
    } else {
      order.push(stored.id);
      seqById.set(stored.id, nextSeq++);
    }
    byId.set(stored.id, stored);
    indexOutputs(stored, byOutput, byLeftover, true);
    writeMatchIndex(stored, true);
    if (source !== undefined) {
      sourceOfId.set(stored.id, source);
      let set = idsBySource.get(source);
      if (set === undefined) {
        set = new Set();
        idsBySource.set(source, set);
      }
      set.add(stored.id);
    } else {
      sourceOfId.delete(stored.id);
    }
  };

  const deleteId = (id: string): void => {
    const previous = byId.get(id);
    if (previous === undefined) return;
    indexOutputs(previous, byOutput, byLeftover, false);
    writeMatchIndex(previous, false);
    byId.delete(id);
    seqById.delete(id);
    sourceOfId.delete(id);
    const index = order.indexOf(id);
    if (index !== -1) order.splice(index, 1);
  };

  return {
    register(recipe, source) {
      if (!isRecipe(recipe)) return false;
      const owner = source !== undefined && isValidSource(source) ? source : undefined;
      put(compactRecipe(recipe), owner);
      return true;
    },
    unregister(id) {
      const previous = byId.get(id);
      if (previous === undefined) return;
      const src = sourceOfId.get(id);
      if (src !== undefined) detachSource(id, src);
      const vanilla = vanillaById.get(id);
      if (src !== undefined && vanilla !== undefined) {
        put(vanilla, undefined);
        return;
      }
      deleteId(id);
    },
    snapshotVanilla() {
      vanillaById.clear();
      for (const [id, recipe] of byId) vanillaById.set(id, recipe);
    },
    dropSource(source) {
      const ids = [...(idsBySource.get(source) ?? [])];
      for (const id of ids) this.unregister(id);
    },
    replaceSource(source, recipes) {
      this.dropSource(source);
      const stolen: string[] = [];
      const seen = new Set<string>();
      for (const recipe of recipes) {
        if (!isRecipe(recipe)) continue;
        const prev = sourceOfId.get(recipe.id);
        if (prev !== undefined && prev !== source && !seen.has(prev)) {
          seen.add(prev);
          stolen.push(prev);
        }
        this.register(recipe, source);
      }
      return stolen;
    },
    recipesForSource(source) {
      const ids = idsBySource.get(source);
      if (ids === undefined) return [];
      const recipes: Recipe[] = [];
      for (const id of ids) {
        const recipe = byId.get(id);
        if (recipe !== undefined) recipes.push(recipe);
      }
      return recipes;
    },
    sourceOf(id) {
      return sourceOfId.get(id);
    },
    get(id) {
      return byId.get(id);
    },
    recipes() {
      return order.map((id) => byId.get(id)!);
    },
    list(filter) {
      const outputSet = filter?.output !== undefined ? byOutput.get(filter.output) : undefined;
      const leftoverSet = filter?.leftover !== undefined ? byLeftover.get(filter.leftover) : undefined;
      if (filter?.output !== undefined && outputSet === undefined) return [];
      if (filter?.leftover !== undefined && leftoverSet === undefined) return [];
      const ids = filter?.station !== undefined ? (byStationOrder.get(filter.station) ?? []) : order;
      const entries: ListEntry[] = [];
      for (const id of ids) {
        if (outputSet !== undefined && !outputSet.has(id)) continue;
        if (leftoverSet !== undefined && !leftoverSet.has(id)) continue;
        entries.push(toListEntry(byId.get(id)!));
      }
      return entries;
    },
    matchIds(query, tagIndex) {
      return matchingHits(query, tagIndex).map((recipe) => recipe.id);
    },
    matchResults(query, tagIndex) {
      return groupRecipeYields(matchingHits(query, tagIndex));
    },
    size() {
      return byId.size;
    },
  };
}
