import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlockTypes,
  ItemStack,
  resetMinecraftServerFake,
  setFakeGenerateLoot,
  system,
  world,
} from "@minecraft/server";
import {
  ENGINE_DUMP_CHAT_DONE,
  ENGINE_DUMP_CHAT_STARTED,
  ENGINE_DUMP_EVENT,
  ENGINE_DUMP_LOG_BEGIN,
  ENGINE_DUMP_LOG_END,
} from "../src/vanillaEngineDumpJob.js";
import { attachVanillaEngineDump, resetVanillaEngineDumpGuard } from "./vanillaEngineDump.js";

afterEach(() => {
  resetVanillaEngineDumpGuard();
  resetMinecraftServerFake();
  vi.restoreAllMocks();
});

describe("attachVanillaEngineDump", () => {
  it("enqueues a runJob from the scriptevent and does not walk getAll on that tick", () => {
    const send = vi.spyOn(world, "sendMessage");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    attachVanillaEngineDump();
    system.sendScriptEvent(ENGINE_DUMP_EVENT, "");
    expect(send).toHaveBeenCalledWith(ENGINE_DUMP_CHAT_STARTED);
    expect(log).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) system.__tick(1);
    expect(log.mock.calls.some((call) => call[0] === ENGINE_DUMP_LOG_BEGIN)).toBe(true);
  });

  it("chats done after a real next-tick wait following END", async () => {
    const send = vi.spyOn(world, "sendMessage");
    vi.spyOn(console, "log").mockImplementation(() => {});
    attachVanillaEngineDump();
    system.sendScriptEvent(ENGINE_DUMP_EVENT, "");
    for (let i = 0; i < 4000; i++) {
      system.__tick(1);
      await Promise.resolve();
      if (send.mock.calls.some((call) => call[0] === ENGINE_DUMP_CHAT_DONE)) break;
    }
    expect(send).toHaveBeenCalledWith(ENGINE_DUMP_CHAT_DONE);
    const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
    expect(logged[0]).toBe(ENGINE_DUMP_LOG_BEGIN);
    expect(logged[logged.length - 1]).toBe(ENGINE_DUMP_LOG_END);
  });

  it("logs diamond generate from iron pickaxe", async () => {
    BlockTypes._setAll(["minecraft:diamond_ore"]);
    setFakeGenerateLoot({
      fromBlock(blockTypeId, toolTypeId) {
        if (blockTypeId === "minecraft:diamond_ore" && toolTypeId === "minecraft:iron_pickaxe") {
          return [new ItemStack("minecraft:diamond", 1)];
        }
        return undefined;
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const send = vi.spyOn(world, "sendMessage");
    attachVanillaEngineDump();
    system.sendScriptEvent(ENGINE_DUMP_EVENT, "");
    for (let i = 0; i < 4000; i++) {
      system.__tick(1);
      await Promise.resolve();
      if (send.mock.calls.some((call) => call[0] === ENGINE_DUMP_CHAT_DONE)) break;
    }
    const lootJson = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .filter((line) => line.startsWith("BEDROCK_REGISTRY_ENGINE_DUMP_LOOT "))
      .map((line) => line.slice("BEDROCK_REGISTRY_ENGINE_DUMP_LOOT ".length))
      .join("");
    expect(lootJson).toContain("minecraft:diamond");
    expect(lootJson).toContain("minecraft:diamond_ore");
  });
});
