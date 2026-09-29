import type { LootDocument, LootEntry } from "@mcbe-registry/client";
import type { TagIndex } from "./match.js";
import {
  blockLootGenerateId,
  lootGenerateSkipIdsFromDump,
  mergeGapBlockLoot,
} from "./vanillaSnapshotMerge.js";

/** Script event that enqueues the engine-gap dump job. */
export const ENGINE_DUMP_EVENT = "bedrockregistry:dump_engine_vanilla";

/** First content-log line when the dump job finishes. */
export const ENGINE_DUMP_LOG_BEGIN = "BEDROCK_REGISTRY_ENGINE_DUMP_BEGIN";

/** Last content-log line when the dump job finishes. */
export const ENGINE_DUMP_LOG_END = "BEDROCK_REGISTRY_ENGINE_DUMP_END";

/** Max JSON characters after each content-log prefix. */
export const ENGINE_DUMP_LOG_CHUNK = 2000;

/** Content-log lines written before a real next-tick wait. */
export const ENGINE_DUMP_LOG_LINES_PER_TICK = 20;

/** Chat when the scriptevent enqueues the job. */
export const ENGINE_DUMP_CHAT_STARTED = "Bedrock Registry engine dump started";

/** Chat when the dump job finishes. */
export const ENGINE_DUMP_CHAT_DONE = "Bedrock Registry engine dump done";

/** Chat when a dump job is already running. */
export const ENGINE_DUMP_CHAT_BUSY = "Bedrock Registry engine dump already running";

/** Committed engine-gap tables plus newly queried ids. */
export interface VanillaEngineDumpResult {
  itemTags: TagIndex;
  blockTags: TagIndex;
  loot: LootDocument[];
  /** Document ids generate already tried with no drops. */
  lootSkipIds: string[];
}

/** One stack from `generateLootFromBlockType` / `generateLootFromEntityType`. */
export interface GeneratedLootStack {
  readonly typeId: string;
  readonly amount: number;
}

/** Empty-hand, then pick tiers, then shears. */
export const ENGINE_DUMP_BLOCK_LOOT_TOOLS: readonly (string | undefined)[] = [
  undefined,
  "minecraft:wooden_pickaxe",
  "minecraft:stone_pickaxe",
  "minecraft:copper_pickaxe",
  "minecraft:iron_pickaxe",
  "minecraft:golden_pickaxe",
  "minecraft:diamond_pickaxe",
  "minecraft:netherite_pickaxe",
  "minecraft:shears",
];

/** Gap entity stems that get a 100-roll kill generate. */
export const ENGINE_DUMP_ENTITY_LOOT_STEMS: readonly string[] = [
  "husk",
  "zombie_villager",
  "zombie_villager_v2",
  "donkey",
  "mule",
  "trader_llama",
  "piglin",
  "sulfur_cube",
  "boat",
  "chest_boat",
  "chest_minecart",
  "hopper_minecart",
  "minecart",
  "tnt_minecart",
  "armor_stand",
  "thrown_trident",
];

/** Kill-loot generate rolls per allowlisted entity. */
export const ENGINE_DUMP_ENTITY_LOOT_ROLLS = 100;

/** Weapon passed to each entity generate roll. */
export const ENGINE_DUMP_ENTITY_LOOT_TOOL = "minecraft:netherite_sword";

/** Native reads the dump job calls; one id per yield after the initial list slices. */
export interface VanillaEngineDumpApi {
  listItemIds(): readonly string[];
  listBlockIds(): readonly string[];
  listEntityIds(): readonly string[];
  itemTags(id: string): readonly string[];
  blockTags(id: string): readonly string[];
  lootFromBlock(
    blockId: string,
    toolTypeId: string | undefined,
  ): Generator<void, readonly GeneratedLootStack[] | undefined, void>;
  lootFromEntity(
    entityId: string,
    toolTypeId: string,
  ): Generator<void, readonly GeneratedLootStack[] | undefined, void>;
  samplesItemIds: ReadonlySet<string>;
  samplesBlockIds: ReadonlySet<string>;
  samplesLootIds: ReadonlySet<string>;
  existingItemDump: TagIndex;
  existingBlockDump: TagIndex;
  existingLootDump: readonly LootDocument[];
  existingLootSkipIds: readonly string[];
}

function stemOf(typeId: string): string {
  const colon = typeId.indexOf(":");
  return colon === -1 ? typeId : typeId.slice(colon + 1);
}

function lootDocumentId(kind: "blocks" | "entities", typeId: string): string {
  return `minecraft:${kind}/${stemOf(typeId)}`;
}

/** `none` when generate used empty hand. */
function harvestToolToken(toolTypeId: string | undefined): string {
  return toolTypeId ?? "none";
}

function skipFilledLootIds(
  samples: ReadonlySet<string>,
  existing: readonly LootDocument[],
  skipIds: readonly string[],
): Set<string> {
  const skip = new Set(samples);
  for (const id of skipIds) skip.add(id);
  for (const row of existing) {
    if (row.entries.length === 0) continue;
    for (const id of lootGenerateSkipIdsFromDump(row)) skip.add(id);
  }
  return skip;
}

function sortTagIndex(index: Record<string, string[]>): TagIndex {
  const out: Record<string, string[]> = {};
  for (const id of Object.keys(index).sort()) {
    const tags = index[id];
    if (tags === undefined) continue;
    out[id] = [...tags].sort();
  }
  return out;
}

function addBlockLootItems(into: Map<string, LootEntry>, stacks: readonly GeneratedLootStack[]): void {
  for (const stack of stacks) {
    if (stack.typeId.length === 0) continue;
    into.set(stack.typeId, { item: stack.typeId });
  }
}

interface EntityLootStats {
  hits: number;
  min: number;
  max: number;
}

function addEntityLootRoll(into: Map<string, EntityLootStats>, stacks: readonly GeneratedLootStack[]): void {
  const amounts = new Map<string, number>();
  for (const stack of stacks) {
    if (stack.typeId.length === 0) continue;
    amounts.set(stack.typeId, (amounts.get(stack.typeId) ?? 0) + stack.amount);
  }
  for (const [typeId, amount] of amounts) {
    const row = into.get(typeId);
    if (row === undefined) {
      into.set(typeId, { hits: 1, min: amount, max: amount });
      continue;
    }
    row.hits += 1;
    if (amount < row.min) row.min = amount;
    if (amount > row.max) row.max = amount;
  }
}

function entityLootEntries(stats: Map<string, EntityLootStats>): LootEntry[] {
  return [...stats.keys()].sort().map((item) => {
    const row = stats.get(item);
    if (row === undefined) return { item };
    return {
      item,
      chance: Math.round((row.hits / ENGINE_DUMP_ENTITY_LOOT_ROLLS) * 100),
      min: row.min,
      max: row.max,
    };
  });
}

/**
 * Diffs `getAll` against samples JSON ids and last dump keys, then queries
 * only the delta. Yields after each native tag read or generate call.
 */
export function* vanillaEngineDumpJob(api: VanillaEngineDumpApi): Generator<void, VanillaEngineDumpResult, void> {
  yield;
  const itemIds = api.listItemIds();
  yield;
  const blockIds = api.listBlockIds();
  yield;
  const entityIds = api.listEntityIds();
  yield;

  const skipItems = new Set([...api.samplesItemIds, ...Object.keys(api.existingItemDump)]);
  const itemTags: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(api.existingItemDump)) itemTags[id] = [...tags];
  for (const id of itemIds) {
    if (skipItems.has(id)) continue;
    try {
      const tags = api.itemTags(id);
      itemTags[id] = [...tags].sort();
    } catch {
      itemTags[id] = [];
    }
    yield;
  }

  const skipBlocks = new Set([...api.samplesBlockIds, ...Object.keys(api.existingBlockDump)]);
  const blockTags: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(api.existingBlockDump)) blockTags[id] = [...tags];
  for (const id of blockIds) {
    if (skipBlocks.has(id)) continue;
    try {
      const tags = api.blockTags(id);
      blockTags[id] = [...tags].sort();
    } catch {
      blockTags[id] = [];
    }
    yield;
  }

  const lootById = new Map<string, LootDocument>();
  for (const row of api.existingLootDump) {
    if (row.entries.length > 0) lootById.set(row.id, row);
  }
  const skipLoot = skipFilledLootIds(api.samplesLootIds, api.existingLootDump, api.existingLootSkipIds);
  const entityLootStems = new Set(ENGINE_DUMP_ENTITY_LOOT_STEMS);

  for (const id of blockIds) {
    if (api.samplesLootIds.has(lootDocumentId("blocks", id))) continue;
    const blockRows: LootDocument[] = [];
    for (const [docId, row] of lootById) {
      if (row.block !== id) continue;
      blockRows.push(row);
      lootById.delete(docId);
    }
    for (const toolTypeId of ENGINE_DUMP_BLOCK_LOOT_TOOLS) {
      const generateId = blockLootGenerateId(id, harvestToolToken(toolTypeId));
      if (skipLoot.has(generateId)) continue;
      try {
        const stacks = yield* api.lootFromBlock(id, toolTypeId);
        if (stacks !== undefined && stacks.length > 0) {
          const items = new Map<string, LootEntry>();
          addBlockLootItems(items, stacks);
          blockRows.push({
            id: generateId,
            block: id,
            tools: [harvestToolToken(toolTypeId)],
            entries: [...items.values()].sort((a, b) => (a.item ?? "").localeCompare(b.item ?? "")),
          });
        } else {
          skipLoot.add(generateId);
        }
      } catch {
        skipLoot.add(generateId);
      }
    }
    for (const row of mergeGapBlockLoot(blockRows)) lootById.set(row.id, row);
    yield;
  }

  for (const id of entityIds) {
    if (!entityLootStems.has(stemOf(id))) continue;
    const documentId = lootDocumentId("entities", id);
    if (skipLoot.has(documentId)) continue;
    const stats = new Map<string, EntityLootStats>();
    try {
      const first = yield* api.lootFromEntity(id, ENGINE_DUMP_ENTITY_LOOT_TOOL);
      if (first !== undefined) {
        if (first.length > 0) addEntityLootRoll(stats, first);
        for (let roll = 1; roll < ENGINE_DUMP_ENTITY_LOOT_ROLLS; roll++) {
          const stacks = yield* api.lootFromEntity(id, ENGINE_DUMP_ENTITY_LOOT_TOOL);
          if (stacks !== undefined && stacks.length > 0) addEntityLootRoll(stats, stacks);
        }
      }
    } catch {
      stats.clear();
    }
    const entries = entityLootEntries(stats);
    if (entries.length > 0) lootById.set(documentId, { id: documentId, entity: id, entries });
    else {
      lootById.delete(documentId);
      skipLoot.add(documentId);
    }
    yield;
  }

  const filledLootIds = new Set(lootById.keys());
  const lootSkipIds = [...skipLoot]
    .filter((id) => !api.samplesLootIds.has(id) && !filledLootIds.has(id))
    .sort();

  return {
    itemTags: sortTagIndex(itemTags),
    blockTags: sortTagIndex(blockTags),
    loot: [...lootById.values()].filter((row) => row.entries.length > 0).sort((a, b) => a.id.localeCompare(b.id)),
    lootSkipIds,
  };
}

function chunkJson(prefix: string, value: unknown): string[] {
  const json = JSON.stringify(value);
  if (json.length <= ENGINE_DUMP_LOG_CHUNK) return [`${prefix} ${json}`];
  const lines: string[] = [];
  for (let offset = 0; offset < json.length; offset += ENGINE_DUMP_LOG_CHUNK) {
    lines.push(`${prefix} ${json.slice(offset, offset + ENGINE_DUMP_LOG_CHUNK)}`);
  }
  return lines;
}

/** Content-log lines for an operator to paste into the dump modules. */
export function engineDumpLogLines(dump: VanillaEngineDumpResult): string[] {
  return [
    ENGINE_DUMP_LOG_BEGIN,
    ...chunkJson("BEDROCK_REGISTRY_ENGINE_DUMP_ITEM_TAGS", dump.itemTags),
    ...chunkJson("BEDROCK_REGISTRY_ENGINE_DUMP_BLOCK_TAGS", dump.blockTags),
    ...chunkJson("BEDROCK_REGISTRY_ENGINE_DUMP_LOOT", dump.loot),
    ...chunkJson("BEDROCK_REGISTRY_ENGINE_DUMP_LOOT_SKIP", dump.lootSkipIds),
    ENGINE_DUMP_LOG_END,
  ];
}

/** Writes dump lines, then `waitTick` every `linesPerTick` lines and once after the last line. */
export async function emitEngineDumpLog(
  dump: VanillaEngineDumpResult,
  write: (line: string) => void,
  waitTick: () => Promise<void>,
  linesPerTick = ENGINE_DUMP_LOG_LINES_PER_TICK,
): Promise<void> {
  let n = 0;
  for (const line of engineDumpLogLines(dump)) {
    write(line);
    n += 1;
    if (n % linesPerTick === 0) await waitTick();
  }
  await waitTick();
}
