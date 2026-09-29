import { describe, expect, it } from "vitest";
import {
  ENGINE_DUMP_BLOCK_LOOT_TOOLS,
  ENGINE_DUMP_ENTITY_LOOT_ROLLS,
  ENGINE_DUMP_LOG_BEGIN,
  ENGINE_DUMP_LOG_CHUNK,
  ENGINE_DUMP_LOG_END,
  emitEngineDumpLog,
  engineDumpLogLines,
  vanillaEngineDumpJob,
} from "./vanillaEngineDumpJob.js";
import type { VanillaEngineDumpApi } from "./vanillaEngineDumpJob.js";

function api(overrides: Partial<VanillaEngineDumpApi> = {}): VanillaEngineDumpApi {
  return {
    listItemIds: () => [],
    listBlockIds: () => [],
    listEntityIds: () => [],
    itemTags: () => [],
    blockTags: () => [],
    lootFromBlock: function* () {
      yield;
      return undefined;
    },
    lootFromEntity: function* () {
      yield;
      return undefined;
    },
    samplesItemIds: new Set(),
    samplesBlockIds: new Set(),
    samplesLootIds: new Set(),
    existingItemDump: {},
    existingBlockDump: {},
    existingLootDump: [],
    existingLootSkipIds: [],
    ...overrides,
  };
}

function runJob(dumpApi: VanillaEngineDumpApi) {
  const job = vanillaEngineDumpJob(dumpApi);
  let steps = 0;
  let next = job.next();
  while (!next.done) {
    steps += 1;
    next = job.next();
  }
  return { steps, value: next.value };
}

describe("vanillaEngineDumpJob", () => {
  it("queries only ids missing from samples JSON and the last dump", () => {
    const seen: string[] = [];
    const { value, steps } = runJob(
      api({
        listItemIds: () => ["minecraft:oak_planks", "minecraft:apple", "minecraft:egg"],
        listBlockIds: () => ["minecraft:red_shrub", "minecraft:diamond_ore"],
        listEntityIds: () => ["minecraft:creeper", "minecraft:cow"],
        samplesItemIds: new Set(["minecraft:oak_planks"]),
        samplesBlockIds: new Set(["minecraft:red_shrub"]),
        samplesLootIds: new Set(["minecraft:entities/creeper", "minecraft:blocks/red_shrub"]),
        existingItemDump: { "minecraft:egg": ["minecraft:egg"] },
        existingLootDump: [],
        itemTags(id) {
          seen.push(`item:${id}`);
          return id === "minecraft:apple" ? ["minecraft:is_food"] : [];
        },
        blockTags(id) {
          seen.push(`block:${id}`);
          return [];
        },
        lootFromBlock: function* (blockId, toolTypeId) {
          yield;
          seen.push(`loot:${blockId}:${toolTypeId ?? "fist"}`);
          if (blockId === "minecraft:diamond_ore" && toolTypeId === "minecraft:iron_pickaxe") {
            return [{ typeId: "minecraft:diamond", amount: 1 }];
          }
          return undefined;
        },
        lootFromEntity: function* (entityId) {
          yield;
          seen.push(`entity:${entityId}`);
          return [{ typeId: "minecraft:rotten_flesh", amount: 1 }];
        },
      }),
    );
    expect(seen.filter((row) => row.startsWith("item:") || row.startsWith("block:") || row.startsWith("entity:"))).toEqual([
      "item:minecraft:apple",
      "block:minecraft:diamond_ore",
    ]);
    expect(seen.filter((row) => row.startsWith("loot:"))).toEqual(
      ENGINE_DUMP_BLOCK_LOOT_TOOLS.map((tool) => `loot:minecraft:diamond_ore:${tool ?? "fist"}`),
    );
    expect(value.itemTags["minecraft:apple"]).toEqual(["minecraft:is_food"]);
    expect(value.itemTags["minecraft:egg"]).toEqual(["minecraft:egg"]);
    expect(value.blockTags["minecraft:diamond_ore"]).toEqual([]);
    expect(value.loot).toEqual([
      {
        id: "minecraft:blocks/diamond_ore/diamond",
        block: "minecraft:diamond_ore",
        tools: ["minecraft:iron_pickaxe"],
        entries: [{ item: "minecraft:diamond" }],
      },
    ]);
    expect(steps).toBeGreaterThan(4);
  });

  it("stores diamond from iron pick generate and cobweb from shears", () => {
    const { value } = runJob(
      api({
        listBlockIds: () => ["minecraft:diamond_ore", "minecraft:web"],
        lootFromBlock: function* (blockId, toolTypeId) {
          yield;
          if (blockId === "minecraft:diamond_ore" && toolTypeId === "minecraft:iron_pickaxe") {
            return [{ typeId: "minecraft:diamond", amount: 1 }];
          }
          if (blockId === "minecraft:web" && toolTypeId === "minecraft:shears") {
            return [{ typeId: "minecraft:web", amount: 1 }];
          }
          return undefined;
        },
      }),
    );
    expect(value.loot).toEqual([
      {
        id: "minecraft:blocks/diamond_ore/diamond",
        block: "minecraft:diamond_ore",
        tools: ["minecraft:iron_pickaxe"],
        entries: [{ item: "minecraft:diamond" }],
      },
      {
        id: "minecraft:blocks/web/web",
        block: "minecraft:web",
        tools: ["minecraft:shears"],
        entries: [{ item: "minecraft:web" }],
      },
    ]);
  });

  it("merges harvest tokens that share the same drop set", () => {
    const { value } = runJob(
      api({
        listBlockIds: () => ["minecraft:diamond_ore"],
        lootFromBlock: function* (blockId, toolTypeId) {
          yield;
          if (
            blockId === "minecraft:diamond_ore" &&
            (toolTypeId === "minecraft:iron_pickaxe" || toolTypeId === "minecraft:diamond_pickaxe")
          ) {
            return [{ typeId: "minecraft:diamond", amount: 1 }];
          }
          return undefined;
        },
      }),
    );
    expect(value.loot).toEqual([
      {
        id: "minecraft:blocks/diamond_ore/diamond",
        block: "minecraft:diamond_ore",
        tools: ["minecraft:diamond_pickaxe", "minecraft:iron_pickaxe"],
        entries: [{ item: "minecraft:diamond" }],
      },
    ]);
  });

  it("writes percent chance and min/max from 100 entity generate rolls", () => {
    let roll = 0;
    const { value } = runJob(
      api({
        listEntityIds: () => ["minecraft:husk", "minecraft:cow"],
        lootFromEntity: function* (entityId) {
          yield;
          if (entityId !== "minecraft:husk") throw new Error("non-allowlist");
          roll += 1;
          if (roll <= 40) return [{ typeId: "minecraft:rotten_flesh", amount: 1 }];
          if (roll <= 50) return [{ typeId: "minecraft:rotten_flesh", amount: 2 }];
          return [];
        },
      }),
    );
    expect(roll).toBe(ENGINE_DUMP_ENTITY_LOOT_ROLLS);
    expect(value.loot).toEqual([
      {
        id: "minecraft:entities/husk",
        entity: "minecraft:husk",
        entries: [{ item: "minecraft:rotten_flesh", chance: 50, min: 1, max: 2 }],
      },
    ]);
  });

  it("omits thrown and empty block generate from the dump", () => {
    const { value } = runJob(
      api({
        listBlockIds: () => ["minecraft:air", "minecraft:stone"],
        lootFromBlock: function* (_blockId, toolTypeId) {
          yield;
          if (toolTypeId === undefined) throw new Error("native");
          return [];
        },
      }),
    );
    expect(value.loot).toEqual([]);
    expect(value.lootSkipIds).toEqual(
      ["minecraft:air", "minecraft:stone"].flatMap((blockId) =>
        ENGINE_DUMP_BLOCK_LOOT_TOOLS.map((tool) =>
          tool === undefined ? `minecraft:blocks/${blockId.slice("minecraft:".length)}` : `minecraft:blocks/${blockId.slice("minecraft:".length)}/${tool.slice("minecraft:".length)}`,
        ),
      ).sort(),
    );
  });

  it("skips loot ids that already have dump entries", () => {
    const tools: Array<string | undefined> = [];
    const { value } = runJob(
      api({
        listBlockIds: () => ["minecraft:diamond_ore"],
        existingLootDump: [
          {
            id: "minecraft:blocks/diamond_ore/diamond",
            block: "minecraft:diamond_ore",
            tools: ["minecraft:iron_pickaxe"],
            entries: [{ item: "minecraft:diamond" }],
          },
        ],
        lootFromBlock: function* (_blockId, toolTypeId) {
          yield;
          tools.push(toolTypeId);
          return undefined;
        },
      }),
    );
    expect(tools).not.toContain("minecraft:iron_pickaxe");
    expect(tools.length).toBe(ENGINE_DUMP_BLOCK_LOOT_TOOLS.length - 1);
    expect(value.loot).toEqual([
      {
        id: "minecraft:blocks/diamond_ore/diamond",
        block: "minecraft:diamond_ore",
        tools: ["minecraft:iron_pickaxe"],
        entries: [{ item: "minecraft:diamond" }],
      },
    ]);
  });

  it("skips loot ids listed in existingLootSkipIds", () => {
    const tools: Array<string | undefined> = [];
    const { value } = runJob(
      api({
        listBlockIds: () => ["minecraft:air"],
        existingLootSkipIds: ["minecraft:blocks/air"],
        lootFromBlock: function* (_blockId, toolTypeId) {
          yield;
          tools.push(toolTypeId);
          return undefined;
        },
      }),
    );
    expect(tools).not.toContain(undefined);
    expect(tools.length).toBe(ENGINE_DUMP_BLOCK_LOOT_TOOLS.length - 1);
    expect(value.loot).toEqual([]);
    expect(value.lootSkipIds).toContain("minecraft:blocks/air");
    expect(value.lootSkipIds).toContain("minecraft:blocks/air/shears");
  });
});

describe("engineDumpLogLines", () => {
  it("wraps compact dump JSON in begin/end markers", () => {
    const lines = engineDumpLogLines({ itemTags: {}, blockTags: {}, loot: [], lootSkipIds: [] });
    expect(lines[0]).toBe(ENGINE_DUMP_LOG_BEGIN);
    expect(lines[lines.length - 1]).toBe(ENGINE_DUMP_LOG_END);
    expect(lines.some((line) => line.startsWith("BEDROCK_REGISTRY_ENGINE_DUMP_LOOT "))).toBe(true);
  });

  it("splits JSON longer than ENGINE_DUMP_LOG_CHUNK across lines", () => {
    const id = "minecraft:x".padEnd(ENGINE_DUMP_LOG_CHUNK + 50, "y");
    const lines = engineDumpLogLines({
      itemTags: { [id]: ["minecraft:planks"] },
      blockTags: {},
      loot: [],
      lootSkipIds: [],
    });
    const tagLines = lines.filter((line) => line.startsWith("BEDROCK_REGISTRY_ENGINE_DUMP_ITEM_TAGS "));
    expect(tagLines.length).toBeGreaterThan(1);
    expect(tagLines.every((line) => line.length <= "BEDROCK_REGISTRY_ENGINE_DUMP_ITEM_TAGS ".length + ENGINE_DUMP_LOG_CHUNK)).toBe(
      true,
    );
  });
});

describe("emitEngineDumpLog", () => {
  it("waits after each batch of linesPerTick and once after the last line", async () => {
    let waits = 0;
    const writes: string[] = [];
    await emitEngineDumpLog(
      { itemTags: {}, blockTags: {}, loot: [], lootSkipIds: [] },
      (line) => {
        writes.push(line);
      },
      async () => {
        waits += 1;
      },
      2,
    );
    expect(writes[0]).toBe(ENGINE_DUMP_LOG_BEGIN);
    expect(writes[writes.length - 1]).toBe(ENGINE_DUMP_LOG_END);
    expect(waits).toBe(Math.floor(writes.length / 2) + 1);
  });

  it("still waits once when every line fits in one batch", async () => {
    let waits = 0;
    await emitEngineDumpLog({ itemTags: {}, blockTags: {}, loot: [], lootSkipIds: [] }, () => {}, async () => {
      waits += 1;
    }, 100);
    expect(waits).toBe(1);
  });
});
