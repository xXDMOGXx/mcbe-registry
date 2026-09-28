import { describe, expect, it } from "vitest";
import { PROTOCOL_SCHEMA } from "@mcbe-registry/client";
import { EVENT } from "./protocol.js";
import { createRegistryHost } from "./rpcHost.js";

describe("createRegistryHost", () => {
  it("answers hello with ready", () => {
    const sent: { id: string; message: string }[] = [];
    const host = createRegistryHost({
      send: (id, message) => sent.push({ id, message }),
      minecraft: "1.21.100",
    });
    host.onEvent(EVENT.hello, "{}");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.id).toBe(EVENT.ready);
    expect(JSON.parse(sent[0]!.message)).toEqual({
      v: PROTOCOL_SCHEMA,
      schema: PROTOCOL_SCHEMA,
      minecraft: "1.21.100",
    });
  });

  it("broadcasts ready", () => {
    const sent: { id: string; message: string }[] = [];
    const host = createRegistryHost({ send: (id, message) => sent.push({ id, message }) });
    host.broadcastReady();
    expect(sent[0]!.id).toBe(EVENT.ready);
  });

  it("ignores schema-1 JSON data ops", () => {
    const sent: { id: string; message: string }[] = [];
    const host = createRegistryHost({
      send: (id, message) => sent.push({ id, message }),
    });
    host.onEvent(
      "reciperegistry:result",
      JSON.stringify({
        v: 1,
        req: "t1",
        station: "minecraft:furnace",
        inputs: ["minecraft:beef"],
      }),
    );
    expect(sent).toEqual([]);
  });

  it("ignores schema-3 JSON discovery", () => {
    const sent: { id: string; message: string }[] = [];
    const host = createRegistryHost({
      send: (id, message) => sent.push({ id, message }),
    });
    host.onEvent("reciperegistry:hello", JSON.stringify({ v: 3, schema: 3 }));
    expect(sent).toEqual([]);
  });
});
