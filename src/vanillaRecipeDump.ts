import type { Recipe } from "./protocol.js";

const TABLE = "minecraft:crafting_table";

function item(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

/** 1×1 plank → button. */
function plankButton(outputId: string, planksId: string): Recipe {
  const planks = item(planksId);
  const id = item(outputId);
  return {
    id,
    stations: [TABLE],
    inputs: [planks],
    outputs: [id],
    type: "shaped",
    pattern: ["#"],
    key: { "#": planks },
  };
}

/** 2×1 plank row → pressure plate. */
function plankPressurePlate(outputId: string, planksId: string): Recipe {
  const planks = item(planksId);
  const id = item(outputId);
  return {
    id,
    stations: [TABLE],
    inputs: [{ item: planks, count: 2 }],
    outputs: [id],
    type: "shaped",
    pattern: ["##"],
    key: { "#": planks },
  };
}

/** 2×3 plank grid → 2 trapdoors. */
function plankTrapdoor(outputId: string, planksId: string): Recipe {
  const planks = item(planksId);
  const id = item(outputId);
  return {
    id,
    stations: [TABLE],
    inputs: [{ item: planks, count: 6 }],
    outputs: [{ item: id, count: 2 }],
    type: "shaped",
    pattern: ["###", "###"],
    key: { "#": planks },
  };
}

/** 2×3 planks + stick → 3 signs. */
function plankSign(outputId: string, planksId: string): Recipe {
  const planks = item(planksId);
  const stick = item("stick");
  const id = item(outputId);
  return {
    id,
    stations: [TABLE],
    inputs: [{ item: planks, count: 6 }, stick],
    outputs: [{ item: id, count: 3 }],
    type: "shaped",
    pattern: ["###", "###", " | "],
    key: { "#": planks, "|": stick },
  };
}

/** Chest + boat → chest boat. */
function chestBoat(wood: string): Recipe {
  const boat = item(`${wood}_boat`);
  const id = item(`${wood}_chest_boat`);
  return {
    id,
    stations: [TABLE],
    inputs: [item("chest"), boat],
    outputs: [id],
    type: "shapeless",
  };
}

/** 1×3 block row → 6 slabs. */
function blockSlab(outputId: string, blockId: string): Recipe {
  const block = item(blockId);
  const id = item(outputId);
  return {
    id,
    stations: [TABLE],
    inputs: [{ item: block, count: 3 }],
    outputs: [{ item: id, count: 6 }],
    type: "shaped",
    pattern: ["###"],
    key: { "#": block },
  };
}

const CLASSIC_WOODS = ["acacia", "birch", "dark_oak", "jungle", "spruce"] as const;

/**
 * Engine-gap crafting recipes with no `behavior_pack/recipes` JSON.
 * Merged after samples JSON; samples ids win.
 */
export const VANILLA_RECIPE_DUMP: Recipe[] = [
  ...CLASSIC_WOODS.map((wood) => plankButton(`${wood}_button`, `${wood}_planks`)),
  plankButton("wooden_button", "oak_planks"),
  ...CLASSIC_WOODS.map((wood) => plankPressurePlate(`${wood}_pressure_plate`, `${wood}_planks`)),
  plankPressurePlate("wooden_pressure_plate", "oak_planks"),
  ...CLASSIC_WOODS.map((wood) => plankTrapdoor(`${wood}_trapdoor`, `${wood}_planks`)),
  plankSign("oak_sign", "oak_planks"),
  plankSign("dark_oak_sign", "dark_oak_planks"),
  ...(["acacia", "birch", "dark_oak", "jungle", "mangrove", "oak", "spruce"] as const).map(chestBoat),
  blockSlab("andesite_slab", "andesite"),
  blockSlab("brick_slab", "brick_block"),
  blockSlab("cobblestone_slab", "cobblestone"),
  blockSlab("dark_prismarine_slab", "dark_prismarine"),
  blockSlab("diorite_slab", "diorite"),
  blockSlab("end_stone_brick_slab", "end_bricks"),
  blockSlab("granite_slab", "granite"),
  blockSlab("mossy_cobblestone_slab", "mossy_cobblestone"),
  blockSlab("mossy_stone_brick_slab", "mossy_stone_bricks"),
  blockSlab("nether_brick_slab", "nether_brick"),
  blockSlab("normal_stone_slab", "stone"),
  blockSlab("polished_andesite_slab", "polished_andesite"),
  blockSlab("polished_diorite_slab", "polished_diorite"),
  blockSlab("polished_granite_slab", "polished_granite"),
  blockSlab("prismarine_slab", "prismarine"),
  blockSlab("quartz_slab", "quartz_block"),
  blockSlab("red_nether_brick_slab", "red_nether_brick"),
  blockSlab("red_sandstone_slab", "red_sandstone"),
  blockSlab("sandstone_slab", "sandstone"),
  blockSlab("smooth_quartz_slab", "smooth_quartz"),
  blockSlab("smooth_red_sandstone_slab", "smooth_red_sandstone"),
  blockSlab("smooth_sandstone_slab", "smooth_sandstone"),
  blockSlab("stone_brick_slab", "stone_bricks"),
];
