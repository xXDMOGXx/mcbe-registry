import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Ingredient, Recipe } from "../src/protocol.js";
import { parseSamplesJson } from "../src/samplesJson.js";
import { VANILLA_BLOCK_TAG_DUMP } from "../src/vanillaBlockTagDump.js";
import { VANILLA_ITEM_TAG_DUMP } from "../src/vanillaItemTagDump.js";
import { VANILLA_LOOT_DUMP } from "../src/vanillaLootDump.js";
import { VANILLA_RECIPE_DUMP } from "../src/vanillaRecipeDump.js";
import { loadVanillaLoot, loadVanillaLootJson } from "../src/vanillaLootProject.js";
import { applyEngineTagDump, mergeRecipesJsonThenDump, mergeTagMaps } from "../src/vanillaSnapshotMerge.js";
import { projectVanillaJson } from "../src/vanillaProject.js";

export { parseSamplesJson, stripJsonLineComments } from "../src/samplesJson.js";

const TAGS_URL = "https://raw.githubusercontent.com/bedrock-dot-dev/vanilla-tags/main/stable/items.json";
const BLOCK_TAGS_URL = "https://raw.githubusercontent.com/bedrock-dot-dev/vanilla-tags/main/stable/blocks.json";

/**
 * Regenerates `src/vanillaCatalog.ts`, `src/vanillaItemTags.ts`,
 * `src/vanillaBlockTags.ts`, `src/vanillaLoot.ts`, and
 * `src/vanillaSamplesCoverage.ts` from a local Mojang `bedrock-samples`
 * tree plus vanilla-tags fetch, committed engine-gap dumps, and
 * `VANILLA_RECIPE_DUMP`.
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

function loadBlockTagsFromSamples(root: string): Map<string, Set<string>> {
  const into = new Map<string, Set<string>>();
  const blocksDir = path.join(root, "behavior_pack", "blocks");
  if (!fs.existsSync(blocksDir)) return into;
  for (const name of fs.readdirSync(blocksDir)) {
    if (!name.endsWith(".json")) continue;
    const json = parseSamplesJson(path.join(blocksDir, name)) as Record<string, unknown>;
    const block = json["minecraft:block"];
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    const description = (block as Record<string, unknown>).description;
    const identifier =
      typeof description === "object" && description !== null && !Array.isArray(description)
        ? (description as Record<string, unknown>).identifier
        : undefined;
    if (typeof identifier !== "string") continue;
    extractItemTagsFromComponents((block as Record<string, unknown>).components, into, identifier);
  }
  return into;
}

function invertBlockDump(dump: Record<string, unknown>): Map<string, Set<string>> {
  const into = new Map<string, Set<string>>();
  for (const [rawTag, rows] of Object.entries(dump)) {
    const tag = rawTag.includes(":") ? rawTag : `minecraft:${rawTag}`;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id =
        typeof row === "string"
          ? row
          : typeof row === "object" && row !== null && !Array.isArray(row)
            ? (row as { id?: unknown }).id
            : undefined;
      if (typeof id !== "string" || id.length === 0) continue;
      const set = into.get(id) ?? new Set<string>();
      set.add(tag);
      into.set(id, set);
    }
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

function loadSamplesFileIds(dir: string, rootKey: "minecraft:item" | "minecraft:block"): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(dir)) return ids;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const json = parseSamplesJson(path.join(dir, name)) as Record<string, unknown>;
    const body = json[rootKey];
    if (typeof body !== "object" || body === null || Array.isArray(body)) continue;
    const description = (body as Record<string, unknown>).description;
    const identifier =
      typeof description === "object" && description !== null && !Array.isArray(description)
        ? (description as Record<string, unknown>).identifier
        : undefined;
    if (typeof identifier === "string" && identifier.length > 0) ids.add(identifier);
  }
  return ids;
}

async function loadTagDump(): Promise<Map<string, Set<string>>> {
  const response = await fetch(TAGS_URL);
  if (!response.ok) throw new Error(`Failed to fetch ${TAGS_URL}: ${response.status}`);
  const dump = (await response.json()) as Record<string, unknown>;
  return invertTagToItems(dump);
}

async function loadBlockTagDump(): Promise<Map<string, Set<string>>> {
  const response = await fetch(BLOCK_TAGS_URL);
  if (!response.ok) throw new Error(`Failed to fetch ${BLOCK_TAGS_URL}: ${response.status}`);
  const dump = (await response.json()) as Record<string, unknown>;
  return invertBlockDump(dump);
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

/** Writes recipe, tag, loot snapshot, and samples-coverage modules from `root`. */
export async function writeVanillaSnapshot(root: string): Promise<void> {
  const minecraft = readMinecraftVersion(root);
  const recipes = mergeRecipesJsonThenDump(
    loadRecipes(path.join(root, "behavior_pack", "recipes")),
    VANILLA_RECIPE_DUMP,
  );
  const packRoot = path.join(root, "behavior_pack");
  const lootJson = loadVanillaLootJson(packRoot);
  const loot = loadVanillaLoot(packRoot, VANILLA_LOOT_DUMP);
  const samplesItemIds = loadSamplesFileIds(path.join(root, "behavior_pack", "items"), "minecraft:item");
  const samplesBlockIds = loadSamplesFileIds(path.join(root, "behavior_pack", "blocks"), "minecraft:block");
  const tagDump = await loadTagDump();
  const itemTags = applyEngineTagDump(
    mergeTagMaps([tagDump, loadItemTagsFromSamples(root)]),
    VANILLA_ITEM_TAG_DUMP,
    samplesItemIds,
  );
  const blockDump = await loadBlockTagDump();
  const blockTags = applyEngineTagDump(
    mergeTagMaps([blockDump, loadBlockTagsFromSamples(root)]),
    VANILLA_BLOCK_TAG_DUMP,
    samplesBlockIds,
  );
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
  writeTsConst(
    path.join(srcDir, "vanillaBlockTags.ts"),
    `import type { TagIndex } from "./match.js";

/** Block id → vanilla block tags for this snapshot (regenerator: scripts/regen-vanilla-catalog.ts). */
export const VANILLA_BLOCK_TAGS: TagIndex = JSON.parse(${JSON.stringify(JSON.stringify(blockTags))}) as TagIndex;
`,
  );
  writeTsConst(
    path.join(srcDir, "vanillaLoot.ts"),
    `import type { LootDocument } from "@mcbe-registry/client";

/** Vendored vanilla loot from samples JSON plus engine-gap dump (regenerator: scripts/regen-vanilla-catalog.ts). */
export const VANILLA_LOOT: LootDocument[] = JSON.parse(${JSON.stringify(JSON.stringify(loot))}) as LootDocument[];
`,
  );
  writeTsConst(
    path.join(srcDir, "vanillaSamplesCoverage.ts"),
    `/** Item identifiers that have a samples \`behavior_pack/items\` JSON file. */
export const VANILLA_SAMPLES_ITEM_IDS: readonly string[] = ${JSON.stringify([...samplesItemIds].sort())};

/** Block identifiers that have a samples \`behavior_pack/blocks\` JSON file. */
export const VANILLA_SAMPLES_BLOCK_IDS: readonly string[] = ${JSON.stringify([...samplesBlockIds].sort())};

/** Loot document ids projected from samples \`loot_tables\` JSON files. */
export const VANILLA_SAMPLES_LOOT_IDS: readonly string[] = ${JSON.stringify(lootJson.map((row) => row.id))};
`,
  );
  console.log(
    `${recipes.length} recipes, ${Object.keys(itemTags).length} tagged items, ${Object.keys(blockTags).length} tagged blocks, ${loot.length} loot tables, minecraft ${minecraft}`,
  );
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
