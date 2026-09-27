import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("mcbe-ipc", () => ({
  default: {},
  PROTO: {
    Int32: {},
    VarInt32: {},
    Float64: {},
    String: {},
    Boolean: {},
    Optional: (s: unknown) => s,
    Array: (s: unknown) => s,
    Map: (k: unknown, v: unknown) => ({ k, v }),
    Object: (s: unknown) => s,
  },
}));

vi.mock("@mcbe-reciperegistry/client/mcbe-ipc", () => ({
  peerIpcFromMcbe: () => ({
    invoke: async () => {
      throw new Error("unused in host unit tests");
    },
    handle: () => () => {},
  }),
  ipcStringFromMcbe: () => ({
    invoke: async () => {
      throw new Error("unused in host unit tests");
    },
    handle: () => () => {},
  }),
}));

import { resetMinecraftServerFake, system, world } from "@mcbab/minecraft-server-fake";
import { HOST_LOADED_MESSAGE } from "@mcbe-reciperegistry/client";
import { startRecipeRegistryHost } from "./host.js";

afterEach(() => {
  resetMinecraftServerFake();
  vi.restoreAllMocks();
});

function tickUntil(predicate: () => boolean, maxTicks = 5000): void {
  for (let i = 0; i < maxTicks; i++) {
    system.__tick(1);
    if (predicate()) return;
  }
  throw new Error("timed out waiting for host");
}

describe("startRecipeRegistryHost", () => {
  it("broadcasts ready after hydrate and answers hello", () => {
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startRecipeRegistryHost();
    expect(received.some((event) => event.id === "reciperegistry:ready")).toBe(false);
    const log = vi.spyOn(console, "log");
    tickUntil(() => received.some((event) => event.id === "reciperegistry:ready"));
    expect(log).toHaveBeenCalledWith(HOST_LOADED_MESSAGE);
    system.sendScriptEvent("reciperegistry:hello", '{"v":1}');
    expect(received.filter((event) => event.id === "reciperegistry:ready").length).toBeGreaterThan(1);
  });

  it("does not read world dynamic property ids before ready", () => {
    const spy = vi.spyOn(world, "getDynamicPropertyIds");
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startRecipeRegistryHost();
    tickUntil(() => received.some((event) => event.id === "reciperegistry:ready"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not answer schema-1 JSON data ops", () => {
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startRecipeRegistryHost();
    tickUntil(() => received.some((event) => event.id === "reciperegistry:ready"));
    const before = received.length;
    system.sendScriptEvent(
      "reciperegistry:result",
      JSON.stringify({
        v: 1,
        req: "t1",
        station: "minecraft:furnace",
        inputs: ["minecraft:cobblestone"],
      }),
    );
    expect(received.slice(before).some((event) => event.id === "reciperegistry:reply")).toBe(false);
  });
});
