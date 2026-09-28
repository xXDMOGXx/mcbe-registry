/**
 * Live Bedrock Registry host: schema-4 MCBE-IPC, JSON discovery, and per-source persist.
 */
import { system, world } from "@minecraft/server";
import { peerIpcFromMcbe } from "@mcbe-registry/client/mcbe-ipc";
import { HOST_LOADED_MESSAGE } from "@mcbe-registry/client";
import {
  attachPersist,
  createCatalog,
  createRegistryHost,
  attachIpcHost,
  transportFromSystem,
  VANILLA_ITEM_TAGS,
  VANILLA_BLOCK_TAGS,
  hydrateCatalogJob,
} from "../src/index.js";
import { VANILLA_CATALOG_MINECRAFT, VANILLA_RECIPES } from "../src/vanillaCatalog.js";
import { VANILLA_FLUIDS } from "../src/vanillaFluids.js";
import { VANILLA_LOOT } from "../src/vanillaLoot.js";
import { attachVanillaEngineDump } from "./vanillaEngineDump.js";

/** Subscribes to schema-4 IPC + JSON discovery, then hydrates vanilla/overlay and broadcasts `ready`. */
export function startBedrockRegistryHost(): void {
  attachVanillaEngineDump();
  const catalog = createCatalog({ tags: { item: VANILLA_ITEM_TAGS, block: VANILLA_BLOCK_TAGS } });
  const dropHooks = {};
  const persist = attachPersist(
    catalog,
    world,
    {
      runTimeout(callback, ticks) {
        system.runTimeout(callback, ticks);
      },
    },
    dropHooks,
  );

  const transport = transportFromSystem(system);
  const host = createRegistryHost({
    send: transport.send,
    minecraft: VANILLA_CATALOG_MINECRAFT,
  });
  attachIpcHost({
    ipc: peerIpcFromMcbe(),
    catalog,
    minecraft: VANILLA_CATALOG_MINECRAFT,
    persist,
    dropHooks,
    onNewerClient: (message) => {
      world.sendMessage(`§e${message}§r`);
    },
  });
  transport.onEvent((id, message) => {
    host.onEvent(id, message);
  });
  system.run(() => {
    system.runJob(
      (function* () {
        yield* hydrateCatalogJob(catalog, VANILLA_RECIPES, persist, { fluids: VANILLA_FLUIDS, loot: VANILLA_LOOT });
        host.broadcastReady();
        console.log(HOST_LOADED_MESSAGE);
      })(),
    );
  });
}
