/**
 * Live one-shot engine-gap dump: tags and loot missing from samples JSON.
 */
import {
  BlockPermutation,
  BlockTypes,
  EntityTypes,
  ItemStack,
  ItemTypes,
  system,
  world,
  type BlockType,
  type EntityType,
  type LootTableManager,
} from "@minecraft/server";
import type { LootDocument } from "@mcbe-registry/client";
import { VANILLA_BLOCK_TAG_DUMP } from "../src/vanillaBlockTagDump.js";
import type { TagIndex } from "../src/match.js";
import {
  ENGINE_DUMP_CHAT_BUSY,
  ENGINE_DUMP_CHAT_DONE,
  ENGINE_DUMP_CHAT_STARTED,
  ENGINE_DUMP_EVENT,
  emitEngineDumpLog,
  vanillaEngineDumpJob,
  type GeneratedLootStack,
  type VanillaEngineDumpResult,
} from "../src/vanillaEngineDumpJob.js";
import { VANILLA_ITEM_TAG_DUMP } from "../src/vanillaItemTagDump.js";
import { VANILLA_LOOT_DUMP } from "../src/vanillaLootDump.js";
import { VANILLA_LOOT_DUMP_SKIP_IDS } from "../src/vanillaLootDumpSkip.js";
import { VANILLA_SAMPLES_BLOCK_IDS, VANILLA_SAMPLES_ITEM_IDS, VANILLA_SAMPLES_LOOT_IDS } from "../src/vanillaSamplesCoverage.js";

let dumpRunning = false;
let sessionDump: VanillaEngineDumpResult | undefined;

function stacksFromNative(stacks: ItemStack[] | undefined): GeneratedLootStack[] | undefined {
  if (stacks === undefined) return undefined;
  return stacks.map((stack) => ({ typeId: stack.typeId, amount: stack.amount }));
}

/** One `generateLootFromBlockType` call; yields after the native generate. */
export function* lootFromBlockType(
  manager: LootTableManager,
  blockType: BlockType | undefined,
  toolTypeId: string | undefined,
): Generator<void, readonly GeneratedLootStack[] | undefined, void> {
  yield;
  if (blockType === undefined) return undefined;
  let tool: ItemStack | undefined;
  if (toolTypeId !== undefined) {
    try {
      tool = new ItemStack(toolTypeId);
    } catch {
      return undefined;
    }
  }
  try {
    const stacks = manager.generateLootFromBlockType(blockType, tool);
    yield;
    return stacksFromNative(stacks);
  } catch {
    yield;
    return undefined;
  }
}

/** One `generateLootFromEntityType` call; yields after the native generate. */
export function* lootFromEntityType(
  manager: LootTableManager,
  entityType: EntityType | undefined,
  toolTypeId: string,
): Generator<void, readonly GeneratedLootStack[] | undefined, void> {
  yield;
  if (entityType === undefined) return undefined;
  let tool: ItemStack;
  try {
    tool = new ItemStack(toolTypeId);
  } catch {
    return undefined;
  }
  try {
    const stacks = manager.generateLootFromEntityType(entityType, tool);
    yield;
    return stacksFromNative(stacks);
  } catch {
    yield;
    return undefined;
  }
}

function listTypeIds(getAll: () => readonly { readonly id: string }[]): string[] {
  try {
    return getAll().map((row) => row.id);
  } catch {
    return [];
  }
}

function mergeTagDump(base: TagIndex, extra: TagIndex | undefined): TagIndex {
  if (extra === undefined) return base;
  const out: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(base)) out[id] = [...tags];
  for (const [id, tags] of Object.entries(extra)) out[id] = [...tags];
  return out;
}

function mergeLootDump(base: readonly LootDocument[], extra: readonly LootDocument[] | undefined): LootDocument[] {
  const byId = new Map<string, LootDocument>();
  for (const row of base) byId.set(row.id, row);
  if (extra !== undefined) {
    for (const row of extra) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function mergeLootSkipIds(base: readonly string[], extra: readonly string[] | undefined): string[] {
  const ids = new Set(base);
  if (extra !== undefined) {
    for (const id of extra) ids.add(id);
  }
  return [...ids];
}

/** Resolves on the next `system.runTimeout` tick. */
function waitDumpLogTick(): Promise<void> {
  return new Promise((resolve) => {
    system.runTimeout(() => {
      resolve();
    }, 1);
  });
}

/** Subscribes `ENGINE_DUMP_EVENT`; the handler only enqueues `system.runJob`. */
export function attachVanillaEngineDump(): void {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== ENGINE_DUMP_EVENT) return;
    if (dumpRunning) {
      world.sendMessage(ENGINE_DUMP_CHAT_BUSY);
      return;
    }
    dumpRunning = true;
    world.sendMessage(ENGINE_DUMP_CHAT_STARTED);
    system.runJob(
      (function* () {
        try {
          const manager = world.getLootTableManager();
          const blockTypes = new Map<string, ReturnType<typeof BlockTypes.get>>();
          const entityTypes = new Map<string, ReturnType<typeof EntityTypes.get>>();
          const dump = yield* vanillaEngineDumpJob({
            listItemIds: () => listTypeIds(() => ItemTypes.getAll()),
            listBlockIds: () => listTypeIds(() => BlockTypes.getAll()),
            listEntityIds: () => listTypeIds(() => EntityTypes.getAll()),
            itemTags(id) {
              return new ItemStack(id).getTags();
            },
            blockTags(id) {
              return BlockPermutation.resolve(id).getTags();
            },
            lootFromBlock(blockId, toolTypeId) {
              if (!blockTypes.has(blockId)) blockTypes.set(blockId, BlockTypes.get(blockId));
              return lootFromBlockType(manager, blockTypes.get(blockId), toolTypeId);
            },
            lootFromEntity(entityId, toolTypeId) {
              if (!entityTypes.has(entityId)) entityTypes.set(entityId, EntityTypes.get(entityId));
              return lootFromEntityType(manager, entityTypes.get(entityId), toolTypeId);
            },
            samplesItemIds: new Set(VANILLA_SAMPLES_ITEM_IDS),
            samplesBlockIds: new Set(VANILLA_SAMPLES_BLOCK_IDS),
            samplesLootIds: new Set(VANILLA_SAMPLES_LOOT_IDS),
            existingItemDump: mergeTagDump(VANILLA_ITEM_TAG_DUMP, sessionDump?.itemTags),
            existingBlockDump: mergeTagDump(VANILLA_BLOCK_TAG_DUMP, sessionDump?.blockTags),
            existingLootDump: mergeLootDump(VANILLA_LOOT_DUMP, sessionDump?.loot),
            existingLootSkipIds: mergeLootSkipIds(VANILLA_LOOT_DUMP_SKIP_IDS, sessionDump?.lootSkipIds),
          });
          sessionDump = dump;
          void emitEngineDumpLog(dump, (line) => {
            console.log(line);
          }, waitDumpLogTick)
            .then(() => {
              world.sendMessage(ENGINE_DUMP_CHAT_DONE);
            })
            .finally(() => {
              dumpRunning = false;
            });
        } catch {
          dumpRunning = false;
        }
      })(),
    );
  });
}

/** Test-only: clears the in-flight dump guard and session dump. */
export function resetVanillaEngineDumpGuard(): void {
  dumpRunning = false;
  sessionDump = undefined;
}
