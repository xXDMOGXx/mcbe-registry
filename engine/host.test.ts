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

vi.mock("@mcbe-registry/client/mcbe-ipc", () => ({
  peerIpcFromMcbe: () => ({
    send() {},
    invoke: async () => {
      throw new Error("unused in host unit tests");
    },
    on: () => () => {},
    handle: () => () => {},
  }),
  ipcStringFromMcbe: () => ({
    send() {},
    invoke: async () => {
      throw new Error("unused in host unit tests");
    },
    on: () => () => {},
    handle: () => () => {},
  }),
}));

import { resetMinecraftServerFake, system, world } from "@minecraft/server";
import { HOST_LOADED_MESSAGE } from "@mcbe-registry/client";
import { startBedrockRegistryHost } from "./host.js";

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

describe("startBedrockRegistryHost", () => {
  it("broadcasts ready after hydrate and answers hello", () => {
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startBedrockRegistryHost();
    expect(received.some((event) => event.id === "bedrockregistry:ready")).toBe(false);
    const log = vi.spyOn(console, "log");
    tickUntil(() => received.some((event) => event.id === "bedrockregistry:ready"));
    expect(log).toHaveBeenCalledWith(HOST_LOADED_MESSAGE);
    system.sendScriptEvent("bedrockregistry:hello", '{"v":1}');
    expect(received.filter((event) => event.id === "bedrockregistry:ready").length).toBeGreaterThan(1);
  });

  it("overlays persist world keys before ready", () => {
    const spy = vi.spyOn(world, "getDynamicPropertyIds");
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startBedrockRegistryHost();
    expect(received.some((event) => event.id === "bedrockregistry:ready")).toBe(false);
    tickUntil(() => received.some((event) => event.id === "bedrockregistry:ready"));
    expect(spy).toHaveBeenCalled();
  });

  it("does not answer schema-1 JSON data ops", () => {
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startBedrockRegistryHost();
    tickUntil(() => received.some((event) => event.id === "bedrockregistry:ready"));
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

  it("does not answer schema-3 JSON hello", () => {
    const received: { id: string; message: string }[] = [];
    system.afterEvents.scriptEventReceive.subscribe((event) => {
      received.push({ id: event.id, message: event.message });
    });
    startBedrockRegistryHost();
    tickUntil(() => received.some((event) => event.id === "bedrockregistry:ready"));
    const before = received.length;
    system.sendScriptEvent("reciperegistry:hello", '{"v":3,"schema":3}');
    expect(received.slice(before).some((event) => event.id === "reciperegistry:ready")).toBe(false);
    expect(received.slice(before).some((event) => event.id === "bedrockregistry:ready")).toBe(false);
  });
});
