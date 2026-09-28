import { BOTTLE, BUCKET } from "@mcbe-registry/client/units";
import type { FluidDocument } from "@mcbe-registry/client";

/** Vanilla liquid documents loaded into RAM (NOTICE). Never persisted. */
export const VANILLA_FLUIDS: readonly FluidDocument[] = [
  {
    id: "minecraft:water",
    kind: "liquid",
    vessels: [
      { filled: "minecraft:water_bucket", empty: "minecraft:bucket", amount: BUCKET },
      {
        filled: "minecraft:potion",
        empty: "minecraft:glass_bottle",
        amount: BOTTLE,
        potion: { effectType: "minecraft:water", deliveryType: "Consume" },
      },
    ],
  },
  {
    id: "minecraft:lava",
    kind: "liquid",
    vessels: [{ filled: "minecraft:lava_bucket", empty: "minecraft:bucket", amount: BUCKET }],
  },
];
