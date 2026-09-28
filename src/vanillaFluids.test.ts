import { describe, expect, it } from "vitest";
import { BOTTLE, BUCKET } from "@mcbe-registry/client";
import { VANILLA_FLUIDS } from "./vanillaFluids.js";

describe("VANILLA_FLUIDS", () => {
  it("snapshots water (bucket + drink bottle) and lava (bucket)", () => {
    const water = VANILLA_FLUIDS.find((row) => row.id === "minecraft:water");
    const lava = VANILLA_FLUIDS.find((row) => row.id === "minecraft:lava");
    expect(water?.vessels.map((v) => v.amount).sort()).toEqual([BOTTLE, BUCKET].sort());
    expect(lava?.vessels).toEqual([{ filled: "minecraft:lava_bucket", empty: "minecraft:bucket", amount: BUCKET }]);
  });
});
