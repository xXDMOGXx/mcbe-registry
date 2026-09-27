import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Ingredient, Recipe } from "../src/protocol.js";
import { projectVanillaJson } from "../src/vanillaProject.js";

const TAGS_URL = "https://raw.githubusercontent.com/bedrock-dot-dev/vanilla-tags/main/stable/items.json";

/** Engine tags the samples item JSON often omits; merged last so a dump never drops planks/egg. */
const TAG_OVERLAY: Readonly<Record<string, readonly string[]>> = {
  "minecraft:oak_planks": ["minecraft:planks"],
  "minecraft:spruce_planks": ["minecraft:planks"],
  "minecraft:birch_planks": ["minecraft:planks"],
  "minecraft:jungle_planks": ["minecraft:planks"],
  "minecraft:acacia_planks": ["minecraft:planks"],
  "minecraft:dark_oak_planks": ["minecraft:planks"],
  "minecraft:mangrove_planks": ["minecraft:planks"],
  "minecraft:cherry_planks": ["minecraft:planks"],
  "minecraft:bamboo_planks": ["minecraft:planks"],
  "minecraft:crimson_planks": ["minecraft:planks"],
  "minecraft:warped_planks": ["minecraft:planks"],
  "minecraft:pale_oak_planks": ["minecraft:planks"],
  "minecraft:egg": ["minecraft:egg"],
  "minecraft:blue_egg": ["minecraft:egg"],
  "minecraft:brown_egg": ["minecraft:egg"],
};

/**
 * Regenerates `src/vanillaCatalog.ts` and `src/vanillaItemTags.ts` from a local
 * Mojang `bedrock-samples` tree plus a vanilla item-tag dump.
 * Looks at `BEDROCK_SAMPLES`, then `../bedrock-samples` next to this repo, then
 * `/home/<user>/dev/bedrock-samples`. CI uses the vendored snapshot; this script
 * does not copy bedrock-samples into the repo.
 */
function samplesRoot(): string | undefined {
  const candidates = [
    process.env.BEDROCK_SAMPLES,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bedrock-samples"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../bedrock-samples"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return candidates.find((dir) => fs.existsSync(path.join(dir, "behavior_pack", "recipes")));
}

/** Drops `//` to end-of-line (Mojang item/recipe JSONC). */
export function stripJsonLineComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "");
}

/** `JSON.parse`, then JSONC `//` retry if Mojang left comments (never strip valid `"///"` patterns). */
export function parseSamplesJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    try {
      return JSON.parse(stripJsonLineComments(raw)) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${filePath}: ${detail}`);
    }
  }
}

function loadRecipes(recipesDir: string): Recipe[] {
  const recipes: Recipe[] = [];
  const names = fs.readdirSync(recipesDir).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const json = parseSamplesJson(path.join(recipesDir, name));
    const recipe = projectVanillaJson(json);
    if (recipe !== undefined) recipes.push(recipe);
  }
  return recipes;
}

function extractItemTagsFromComponents(components: unknown, into: Map<string, Set<string>>, itemId: string): void {
  if (typeof components !== "object" || components === null || Array.isArray(components)) return;
  const tagsComponent = (components as Record<string, unknown>)["minecraft:tags"];
  let tags: unknown;
  if (Array.isArray(tagsComponent)) tags = tagsComponent;
  else if (typeof tagsComponent === "object" && tagsComponent !== null && !Array.isArray(tagsComponent)) {
    tags = (tagsComponent as Record<string, unknown>).tags;
  }
  if (!Array.isArray(tags)) return;
  const set = into.get(itemId) ?? new Set<string>();
  for (const tag of tags) {
    if (typeof tag === "string" && tag.length > 0) set.add(tag);
  }
  if (set.size > 0) into.set(itemId, set);
}

function loadItemTagsFromSamples(root: string): Map<string, Set<string>> {
  const into = new Map<string, Set<string>>();
  const itemsDir = path.join(root, "behavior_pack", "items");
  if (!fs.existsSync(itemsDir)) return into;
  for (const name of fs.readdirSync(itemsDir)) {
    if (!name.endsWith(".json")) continue;
    const json = parseSamplesJson(path.join(itemsDir, name)) as Record<string, unknown>;
    const item = json["minecraft:item"];
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const description = (item as Record<string, unknown>).description;
    const identifier =
      typeof description === "object" && description !== null && !Array.isArray(description)
        ? (description as Record<string, unknown>).identifier
        : undefined;
    if (typeof identifier !== "string") continue;
    extractItemTagsFromComponents((item as Record<string, unknown>).components, into, identifier);
  }
  return into;
}

function invertTagToItems(dump: Record<string, unknown>): Map<string, Set<string>> {
  const into = new Map<string, Set<string>>();
  for (const [tag, items] of Object.entries(dump)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item !== "string" || item.length === 0) continue;
      const set = into.get(item) ?? new Set<string>();
      set.add(tag);
      into.set(item, set);
    }
  }
  return into;
}

function mergeTagMaps(maps: Map<string, Set<string>>[]): Record<string, string[]> {
  const merged = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [item, tags] of map) {
      const set = merged.get(item) ?? new Set<string>();
      for (const tag of tags) set.add(tag);
      merged.set(item, set);
    }
  }
  for (const [item, tags] of Object.entries(TAG_OVERLAY)) {
    const set = merged.get(item) ?? new Set<string>();
    for (const tag of tags) set.add(tag);
    merged.set(item, set);
  }
  const out: Record<string, string[]> = {};
  for (const item of [...merged.keys()].sort()) {
    out[item] = [...merged.get(item)!].sort();
  }
  return out;
}

async function loadTagDump(): Promise<Map<string, Set<string>>> {
  const response = await fetch(TAGS_URL);
  if (!response.ok) throw new Error(`Failed to fetch ${TAGS_URL}: ${response.status}`);
  const dump = (await response.json()) as Record<string, unknown>;
  return invertTagToItems(dump);
}

function collectRecipeTags(recipes: readonly Recipe[]): Set<string> {
  const tags = new Set<string>();
  const visit = (ingredient: Ingredient): void => {
    if (typeof ingredient === "string") return;
    if (ingredient.tag !== undefined) tags.add(ingredient.tag);
  };
  for (const recipe of recipes) {
    for (const ingredient of recipe.inputs) visit(ingredient);
    if (recipe.key !== undefined) {
      for (const ingredient of Object.values(recipe.key)) visit(ingredient);
    }
  }
  return tags;
}

function writeTsConst(filePath: string, body: string): void {
  fs.writeFileSync(filePath, body);
  console.log(`Wrote ${filePath}`);
}

/** `latest.version` from a `bedrock-samples` `version.json`. */
export function readMinecraftVersion(root: string): string {
  const versionPath = path.join(root, "version.json");
  const raw = JSON.parse(fs.readFileSync(versionPath, "utf8")) as { latest?: { version?: unknown } };
  const version = raw.latest?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`No latest.version in ${versionPath}`);
  }
  return version;
}

/** Writes `src/vanillaCatalog.ts` and `src/vanillaItemTags.ts` from `root`. */
export async function writeVanillaSnapshot(root: string): Promise<void> {
  const minecraft = readMinecraftVersion(root);
  const recipes = loadRecipes(path.join(root, "behavior_pack", "recipes"));
  const tagDump = await loadTagDump();
  const itemTags = mergeTagMaps([tagDump, loadItemTagsFromSamples(root)]);
  const recipeTags = collectRecipeTags(recipes);
  const missing = [...recipeTags].filter((tag) => !Object.values(itemTags).some((tags) => tags.includes(tag)));
  if (missing.length > 0) {
    console.warn(`Tag dump has no members for recipe tags: ${missing.join(", ")}`);
  }

  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  writeTsConst(
    path.join(srcDir, "vanillaCatalog.ts"),
    `import type { Recipe } from "./protocol.js";

/** Bedrock version this snapshot was projected from (\`bedrock-samples\` version.json \`latest\`). */
export const VANILLA_CATALOG_MINECRAFT = ${JSON.stringify(minecraft)};

/** Vendored vanilla catalog projected from Mojang recipe JSON (regenerator: scripts/regen-vanilla-catalog.ts). */
export const VANILLA_RECIPES: Recipe[] = JSON.parse(${JSON.stringify(JSON.stringify(recipes))}) as Recipe[];
`,
  );
  writeTsConst(
    path.join(srcDir, "vanillaItemTags.ts"),
    `import type { TagIndex } from "./match.js";

/** Item id → vanilla item tags for this snapshot (regenerator: scripts/regen-vanilla-catalog.ts). */
export const VANILLA_ITEM_TAGS: TagIndex = JSON.parse(${JSON.stringify(JSON.stringify(itemTags))}) as TagIndex;
`,
  );
  console.log(`${recipes.length} recipes, ${Object.keys(itemTags).length} tagged items, minecraft ${minecraft}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = samplesRoot();
  if (!root) {
    console.error("No local bedrock-samples tree found. Vendored snapshot is left unchanged.");
    process.exit(1);
  }
  await writeVanillaSnapshot(root);
}
