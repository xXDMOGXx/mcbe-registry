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
} from "@mcbe-registry/client";
import { createCatalog } from "./catalog.js";
import { attachIpcHost } from "./ipcHost.js";
import { attachPersist } from "./persist.js";
import { readSource, writeSource, type DynamicPropertyStore } from "./sourceStore.js";
import type { Recipe } from "./protocol.js";

function fakeIpc(): PeerIpc & { sent: { channel: string; value: unknown }[] } {
  const handlers = new Map<string, (value: unknown) => unknown>();
  const listeners = new Map<string, Array<(value: unknown) => void>>();
  const sent: { channel: string; value: unknown }[] = [];
  return {
    sent,
    send(channel, _ser, value) {
      sent.push({ channel, value });
      for (const listener of listeners.get(channel) ?? []) listener(value);
    },
    invoke(channel, _ser, value) {
      const handler = handlers.get(channel);
      if (handler === undefined) return Promise.reject(new Error(`no handler ${channel}`));
      return Promise.resolve(handler(value));
    },
    on(channel, _deser, listener) {
      const list = listeners.get(channel) ?? [];
      list.push(listener as (value: unknown) => void);
      listeners.set(channel, list);
      return () => {
        const next = (listeners.get(channel) ?? []).filter((row) => row !== listener);
        listeners.set(channel, next);
      };
    },
    handle(channel, _deser, _ser, listener) {
      handlers.set(channel, listener as (value: unknown) => unknown);
      return () => handlers.delete(channel);
    },
  };
}

describe("attachIpcHost", () => {
  beforeEach(() => resetCompatibilityWarns());

  it("serves match and result over schema-4 IPC", async () => {
    const catalog = createCatalog();
    const recipe: Recipe = {
      id: "mymod:crush_cobble",
      stations: ["mymod:crusher"],
      inputs: ["minecraft:cobblestone"],
      outputs: ["minecraft:gravel"],
    };
    catalog.register(recipe);
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog, minecraft: "1.21.100" });

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
      h("bedrockregistry:ready", JSON.stringify({ v: PROTOCOL_SCHEMA, schema: PROTOCOL_SCHEMA, minecraft: "1.21.100" }));
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
    writeSource(store, "demo", "recipe", "fp-demo", [recipe]);
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

  it("does not serve schema-3 reciperegistry channels", async () => {
    const catalog = createCatalog();
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    await expect(
      ipc.invoke("reciperegistry.match", Proto.MatchQuery, { station: "minecraft:crafting_table" }, Proto.MatchReply),
    ).rejects.toThrow(/no handler reciperegistry.match/);
  });

  it("item register ping skips rewrite of the recipe blob", async () => {
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
    await ipc.invoke(
      CHANNEL.register,
      Proto.RegisterAsk,
      { source: "demo", fp: "fp-recipe", recipes: [encodeRecipe(recipe)] },
      Proto.OkReply,
    );
    await ipc.invoke(
      CHANNEL.register,
      Proto.RegisterAsk,
      {
        source: "demo",
        kind: "item",
        fp: "fp-item",
        recipes: [],
        documents: [JSON.stringify({ id: "demo:widget", extra: { a: 1 } })],
      },
      Proto.OkReply,
    );
    clock.advance(1);
    clock.advance(1);
    expect(readSource(store, "demo", "recipe")?.fp).toBe("fp-recipe");
    await expect(
      ipc.invoke(
        CHANNEL.register,
        Proto.RegisterAsk,
        { source: "demo", kind: "item", fp: "fp-item", recipes: [] },
        Proto.OkReply,
      ),
    ).resolves.toEqual({ ok: true });
    expect(catalog.getDocument("item", "demo:widget")).toEqual({ id: "demo:widget", extra: { a: 1 } });
    const got = await ipc.invoke(CHANNEL.get, Proto.GetAsk, { kind: "item", id: "demo:widget" }, Proto.GetReply);
    expect(JSON.parse((got as { document: string }).document)).toEqual({ id: "demo:widget", extra: { a: 1 } });
  });

  it("session register without source writes no persist keys", async () => {
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
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog, persist });
    await ipc.invoke(
      CHANNEL.register,
      Proto.RegisterAsk,
      { recipes: [], documents: [JSON.stringify({ id: "demo:session" })], kind: "item" },
      Proto.OkReply,
    );
    expect(catalog.getDocument("item", "demo:session")).toEqual({ id: "demo:session" });
    expect(store.getDynamicPropertyIds()).toEqual([]);
  });

  it("rejects unknown register kinds", async () => {
    const catalog = createCatalog();
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    await expect(
      ipc.invoke(CHANNEL.register, Proto.RegisterAsk, { kind: "machine", recipes: [] }, Proto.OkReply),
    ).resolves.toEqual({ ok: false, err: "bad" });
  });

  it("rejects non-integer fluid vessel amounts", async () => {
    const catalog = createCatalog();
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    await expect(
      ipc.invoke(
        CHANNEL.register,
        Proto.RegisterAsk,
        {
          kind: "fluid",
          recipes: [],
          documents: [
            JSON.stringify({
              id: "addon:latex",
              kind: "liquid",
              vessels: [{ filled: "addon:latex_bottle", empty: "minecraft:glass_bottle", amount: 333.3 }],
            }),
          ],
        },
        Proto.OkReply,
      ),
    ).resolves.toEqual({ ok: false, err: "bad" });
    expect(catalog.getDocument("fluid", "addon:latex")).toBeUndefined();
    expect(ipc.sent).toEqual([]);
  });

  it("rejects non-integer loot chance", async () => {
    const catalog = createCatalog();
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    await expect(
      ipc.invoke(
        CHANNEL.register,
        Proto.RegisterAsk,
        {
          kind: "loot",
          recipes: [],
          documents: [
            JSON.stringify({
              id: "addon:drops",
              entity: "addon:mob",
              entries: [{ item: "minecraft:stick", chance: 12.5 }],
            }),
          ],
        },
        Proto.OkReply,
      ),
    ).resolves.toEqual({ ok: false, err: "bad" });
    expect(catalog.getDocument("loot", "addon:drops")).toBeUndefined();
  });

  it("lists loot by harvest tool", async () => {
    const catalog = createCatalog();
    catalog.registerDocument("loot", {
      id: "addon:ore",
      block: "addon:ore",
      tools: ["minecraft:iron_pickaxe", "none"],
      entries: [{ item: "addon:gem" }],
    });
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    const listed = (await ipc.invoke(
      CHANNEL.list,
      Proto.ListFilter,
      { kind: "loot", tool: "minecraft:iron_pickaxe" },
      Proto.ListReply,
    )) as { documents?: string[] };
    expect(listed.documents).toHaveLength(1);
    expect(JSON.parse(listed.documents![0]!)).toMatchObject({
      id: "addon:ore",
      tools: ["minecraft:iron_pickaxe", "none"],
    });
  });

  it("subscribe is watch-only; fingerprint ping does not send", async () => {
    const catalog = createCatalog();
    catalog.registerDocument("fluid", { id: "minecraft:water", kind: "liquid", vessels: [] });
    catalog.registerDocument("fluid", { id: "mymod:etchant", kind: "liquid", vessels: [{ filled: "a", empty: "b", amount: 1000 }] }, "mymod");
    catalog.registerDocument("fluid", { id: "other:latex", kind: "liquid", vessels: [{ filled: "c", empty: "d", amount: 1000 }] }, "other");
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    await expect(
      ipc.invoke(CHANNEL.subscribe, Proto.SubscribeAsk, { kinds: ["fluid"], source: "mymod" }, Proto.OkReply),
    ).resolves.toEqual({ ok: true });
    const overlay = await ipc.invoke(
      CHANNEL.list,
      Proto.ListFilter,
      { kind: "fluid", vanilla: false },
      Proto.ListReply,
    );
    expect(overlay).toEqual({
      entries: [],
      documents: [
        JSON.stringify({ id: "mymod:etchant", kind: "liquid", vessels: [{ filled: "a", empty: "b", amount: 1000 }] }),
        JSON.stringify({ id: "other:latex", kind: "liquid", vessels: [{ filled: "c", empty: "d", amount: 1000 }] }),
      ],
      sources: ["mymod", "other"],
    });
    await ipc.invoke(
      CHANNEL.register,
      Proto.RegisterAsk,
      { source: "other", kind: "fluid", fp: "x", recipes: [] },
      Proto.OkReply,
    );
    expect(ipc.sent).toEqual([]);
  });

  it("register miss sends updated for that source and kind after subscribe", async () => {
    const catalog = createCatalog();
    const ipc = fakeIpc();
    attachIpcHost({ ipc, catalog });
    await ipc.invoke(CHANNEL.subscribe, Proto.SubscribeAsk, { kinds: ["fluid"] }, Proto.OkReply);
    await ipc.invoke(
      CHANNEL.register,
      Proto.RegisterAsk,
      {
        source: "other",
        kind: "fluid",
        fp: "fp-latex",
        recipes: [],
        documents: [
          JSON.stringify({
            id: "other:latex",
            kind: "liquid",
            vessels: [{ filled: "other:latex_bottle", empty: "minecraft:glass_bottle", amount: 1000 }],
          }),
        ],
      },
      Proto.OkReply,
    );
    expect(ipc.sent).toHaveLength(1);
    expect(ipc.sent[0]?.channel).toBe(CHANNEL.updated);
    expect(ipc.sent[0]?.value).toEqual({ kind: "fluid", source: "other" });
  });
});

const CHANNEL_HELLO = "bedrockregistry.hello";
