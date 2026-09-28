/** Script-event ids for JSON discovery (`hello` / `ready`) and host claim. */
export const EVENT = {
  ready: "bedrockregistry:ready",
  hello: "bedrockregistry:hello",
  claim: "bedrockregistry:claim",
} as const;

/** Object form of an ingredient when shorthand is not enough. */
export interface IngredientObject {
  item?: string;
  tag?: string;
  fluid?: string;
  gas?: string;
  count?: number;
  amount?: number;
  slot?: string;
  /** Tags the query item has; ignored on stored recipes. */
  tags?: string[];
}

/** Item or tag ingredient: a type-id string, or an object with count/slot/tag. */
export type Ingredient = string | IngredientObject;

/** One catalog document: required `id` / `stations` / `inputs` / `outputs`, plus optional fields and unknown keys. */
export interface Recipe {
  id: string;
  stations: string[];
  inputs: Ingredient[];
  outputs: Ingredient[];
  type?: string;
  pattern?: string[];
  key?: Record<string, Ingredient>;
  leftover?: Ingredient;
  priority?: number;
  duration?: number;
  energy?: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Compact list row: identity, optional type hint, station block ids, leftover when present. */
export interface ListEntry {
  id: string;
  type?: string;
  stations: string[];
  leftover?: Ingredient;
}

/** Filters for `list`: station and/or reverse indexes on output / leftover item ids. */
export interface ListFilter {
  station?: string;
  /** Item id a recipe lists in `outputs`. */
  output?: string;
  /** Item id a recipe lists as `leftover`. */
  leftover?: string;
  /** Item, fluid, or gas id a recipe lists in `inputs`. */
  input?: string;
}

/** Yield of a match: outputs plus optional leftover/duration/energy/extra/type — no recipe id. */
export interface MatchResult {
  outputs: Ingredient[];
  leftover?: Ingredient;
  duration?: number;
  energy?: number;
  extra?: Record<string, unknown>;
  type?: string;
}

/** Match request: a station block id plus a 3×3 grid, vanilla pattern+key, and/or a bag of ingredients. */
export interface MatchQuery {
  station: string;
  grid?: (string | null)[];
  /** Vanilla shaped rows (`["A","A"]`); expanded to a grid when `key` is also set. */
  pattern?: string[];
  /** Vanilla shaped symbol map (`{ A: "minecraft:oak_planks" }`); used with `pattern`. */
  key?: Record<string, Ingredient>;
  inputs?: Ingredient[];
}

/** `bedrockregistry:ready` body. `minecraft` is the vanilla snapshot version, not the running client. */
export interface ReadyEnvelope {
  v: number;
  schema: number;
  minecraft?: string;
}

/** `bedrockregistry:hello` body. */
export interface HelloEnvelope {
  v: number;
}
