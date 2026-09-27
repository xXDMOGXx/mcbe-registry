import { describe, expect, it, beforeEach, vi } from "vitest";

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

import {
  type PeerIpc,
  CHANNEL,
  createClient,
  encodeRecipe,
  PROTOCOL_SCHEMA,
  HOST_NEEDS_UPDATE_WARN,
  resetCompatibilityWarns,
  Proto,
} from "@mcbe-reciperegistry/client";
import { createCatalog } from "./catalog.js";
import { attachIpcHost } from "./ipcHost.js";
import { attachPersist } from "./persist.js";
import { readSource, writeSource, type DynamicPropertyStore } from "./sourceStore.js";
import { VANILLA_ITEM_TAGS } from "./vanillaProject.js";
import type { Recipe } from "./protocol.js";

function fakeIpc(): PeerIpc {
  const handlers = new Map<string, (value: unknown) => unknown>();
  return {
    invoke(channel, _ser, value) {
      const handler = handlers.get(channel);
      if (handler === undefined) return Promise.reject(new Error(`no handler ${channel}`));
      return Promise.resolve(handler(value));
    },
    handle(channel, _deser, _ser, listener) {
      handlers.set(channel, listener as (value: unknown) => unknown);
      return () => handlers.delete(channel);
    },
  };
}

describe("attachIpcHost", () => {
  beforeEach(() => resetCompatibilityWarns());

  it("serves match and result over schema-3 IPC", async () => {
    const catalog = createCatalog();
    const recipe: Recipe = {
      id: "mymod:crush_cobble",
      stations: ["mymod:crusher"],
      inputs: ["minecraft:cobblestone"],
      outputs: ["minecraft:gravel"],
    };
    catalog.register(recipe);
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog, tagIndex: VANILLA_ITEM_TAGS, minecraft: "1.21.100" });

    const discoveryHandlers: Array<(id: string, message: string) => void> = [];
    const client = createClient({
      ipc,
      discovery: {
        send() {},
        onEvent(handler) {
          discoveryHandlers.push(handler);
          return () => {};
        },
      },
      clock: {
        runTimeout(callback) {
          const id = setTimeout(callback, 0);
          return () => clearTimeout(id);
        },
      },
      timeoutTicks: 5,
    });
    for (const h of discoveryHandlers) {
      h("reciperegistry:ready", JSON.stringify({ v: PROTOCOL_SCHEMA, schema: PROTOCOL_SCHEMA, minecraft: "1.21.100" }));
    }
    await expect(client.waitReady()).resolves.toBe(true);
    expect(client.catalogMinecraft()).toBe("1.21.100");
    await expect(client.match({ station: "mymod:crusher", inputs: ["minecraft:cobblestone"] })).resolves.toEqual([
      "mymod:crush_cobble",
    ]);
    await expect(client.result({ station: "mymod:crusher", inputs: ["minecraft:cobblestone"] })).resolves.toEqual([
      { outputs: ["minecraft:gravel"] },
    ]);
    client.dispose();
  });

  it("warns once when IPC hello schema is above the host", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m: string) => {
      lines.push(m);
    });
    const catalog = createCatalog();
    const ipc = fakeIpc();
    const chat: string[] = [];
    attachIpcHost({
      ipc,
      catalog,
      onNewerClient: (message) => {
        chat.push(message);
      },
    });
    await ipc.invoke(CHANNEL_HELLO, Proto.Hello, { schema: PROTOCOL_SCHEMA + 1 }, Proto.Hello);
    await ipc.invoke(CHANNEL_HELLO, Proto.Hello, { schema: PROTOCOL_SCHEMA + 1 }, Proto.Hello);
    expect(lines.filter((line) => line === HOST_NEEDS_UPDATE_WARN)).toHaveLength(1);
    expect(chat).toEqual([HOST_NEEDS_UPDATE_WARN]);
  });

  it("register replaceSource is visible before persist DPs flush", async () => {
    const properties = new Map<string, string | number | boolean>();
    const store: DynamicPropertyStore = {
      getDynamicProperty(id) {
        return properties.get(id);
      },
      setDynamicProperty(id, value) {
        if (value === undefined) properties.delete(id);
        else properties.set(id, value);
      },
      getDynamicPropertyIds() {
        return [...properties.keys()];
      },
    };
    const pending: { at: number; callback: () => void }[] = [];
    let now = 0;
    const clock = {
      runTimeout(callback: () => void, ticks: number) {
        pending.push({ at: now + ticks, callback });
      },
      advance(ticks: number) {
        now += ticks;
        const due = pending.filter((entry) => entry.at <= now);
        pending.splice(0, pending.length, ...pending.filter((entry) => entry.at > now));
        for (const entry of due) entry.callback();
      },
    };
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, clock);
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog, persist });
    const recipe: Recipe = {
      id: "demo:fiber_block_from_fiber",
      stations: ["minecraft:crafting_table"],
      inputs: ["demo:raw_fiber"],
      outputs: ["demo:fiber_block"],
    };
    await expect(
      ipc.invoke(CHANNEL.register, Proto.RegisterAsk, {
        source: "demo",
        fp: "fp-demo",
        recipes: [encodeRecipe(recipe)],
      }, Proto.OkReply),
    ).resolves.toEqual({ ok: true });
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(recipe);
    expect(persist.fpOf("demo")).toBe("fp-demo");
    expect(readSource(store, "demo")).toBeUndefined();
    clock.advance(1);
    expect(readSource(store, "demo")?.fp).toBe("fp-demo");
  });

  it("fingerprint ping overlays persist blobs on a hit", async () => {
    const properties = new Map<string, string | number | boolean>();
    const store: DynamicPropertyStore = {
      getDynamicProperty(id) {
        return properties.get(id);
      },
      setDynamicProperty(id, value) {
        if (value === undefined) properties.delete(id);
        else properties.set(id, value);
      },
      getDynamicPropertyIds() {
        return [...properties.keys()];
      },
    };
    const catalog = createCatalog();
    const persist = attachPersist(catalog, store, { runTimeout() {} });
    const recipe: Recipe = {
      id: "demo:fiber_block_from_fiber",
      stations: ["minecraft:crafting_table"],
      inputs: ["demo:raw_fiber"],
      outputs: ["demo:fiber_block"],
    };
    writeSource(store, "demo", "fp-demo", [recipe]);
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog, persist });
    expect(catalog.get("demo:fiber_block_from_fiber")).toBeUndefined();
    await expect(
      ipc.invoke(CHANNEL.register, Proto.RegisterAsk, {
        source: "demo",
        fp: "fp-demo",
        recipes: [],
      }, Proto.OkReply),
    ).resolves.toEqual({ ok: true });
    expect(catalog.get("demo:fiber_block_from_fiber")).toEqual(recipe);
  });
});

const CHANNEL_HELLO = "reciperegistry.hello";
