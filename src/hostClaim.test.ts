import { describe, expect, it } from "vitest";
import type { Transport } from "./transport.js";
import {
  HOST_CLAIM_EVENT,
  HOST_ELECTION_TICKS,
  STANDALONE_HOST_CLAIMANT,
  claimantFromMessage,
  electHost,
  runHostElection,
} from "./hostClaim.js";

function createClaimBus(): { transport: Transport; advance: (tick: number) => void } {
  const handlers = new Set<(id: string, message: string) => void>();
  const timeouts: { at: number; cb: () => void }[] = [];
  let now = 0;
  const transport: Transport = {
    send(id, message) {
      for (const handler of [...handlers]) handler(id, message);
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    runTimeout(callback, ticks) {
      timeouts.push({ at: now + ticks, cb: callback });
      return () => {
        const i = timeouts.findIndex((t) => t.cb === callback);
        if (i >= 0) timeouts.splice(i, 1);
      };
    },
  };
  function advance(tick: number): void {
    while (true) {
      let next: (typeof timeouts)[number] | undefined;
      for (const t of timeouts) {
        if (t.at > tick) continue;
        if (!next || t.at < next.at) next = t;
      }
      if (!next) {
        now = tick;
        return;
      }
      now = next.at;
      timeouts.splice(timeouts.indexOf(next), 1);
      next.cb();
    }
  }
  return { transport, advance };
}

describe("electHost", () => {
  it("picks standalone when both packs announced", () => {
    expect(electHost(new Set([STANDALONE_HOST_CLAIMANT, "xxdmogxx_dns"]))).toBe(
      STANDALONE_HOST_CLAIMANT,
    );
  });

  it("picks the only announcer", () => {
    expect(electHost(new Set(["xxdmogxx_dns"]))).toBe("xxdmogxx_dns");
  });

  it("picks lexicographic first among non-standalone announcers", () => {
    expect(electHost(new Set(["zz_embed", "aa_embed"]))).toBe("aa_embed");
  });

  it("returns undefined when nobody announced", () => {
    expect(electHost(new Set())).toBeUndefined();
  });
});

describe("claimantFromMessage", () => {
  it("reads a claimant string", () => {
    expect(claimantFromMessage(JSON.stringify({ claimant: "xxdmogxx_dns" }))).toBe("xxdmogxx_dns");
  });

  it("ignores invalid bodies", () => {
    expect(claimantFromMessage("not-json")).toBeUndefined();
    expect(claimantFromMessage("{}")).toBeUndefined();
    expect(claimantFromMessage(JSON.stringify({ claimant: "" }))).toBeUndefined();
  });
});

describe("runHostElection", () => {
  it("starts only the standalone pack when two announcers share a bus", () => {
    const { transport, advance } = createClaimBus();
    const started: string[] = [];
    runHostElection({
      transport,
      claimant: STANDALONE_HOST_CLAIMANT,
      onElected: () => {
        started.push(STANDALONE_HOST_CLAIMANT);
      },
    });
    runHostElection({
      transport,
      claimant: "xxdmogxx_dns",
      onElected: () => {
        started.push("xxdmogxx_dns");
      },
    });
    advance(HOST_ELECTION_TICKS);
    expect(started).toEqual([STANDALONE_HOST_CLAIMANT]);
  });

  it("starts the only announcer", () => {
    const { transport, advance } = createClaimBus();
    let started = false;
    runHostElection({
      transport,
      claimant: "xxdmogxx_dns",
      onElected: () => {
        started = true;
      },
    });
    advance(HOST_ELECTION_TICKS);
    expect(started).toBe(true);
  });

  it("ignores non-claim script events", () => {
    const { transport, advance } = createClaimBus();
    let started = false;
    runHostElection({
      transport,
      claimant: "xxdmogxx_dns",
      onElected: () => {
        started = true;
      },
    });
    transport.send("bedrockregistry:hello", JSON.stringify({ claimant: STANDALONE_HOST_CLAIMANT }));
    advance(1);
    transport.send(HOST_CLAIM_EVENT, "not-json");
    advance(HOST_ELECTION_TICKS);
    expect(started).toBe(true);
  });
});
