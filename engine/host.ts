/**
 * Live Recipe Registry host: schema-3 MCBE-IPC, JSON discovery, and per-source persist.
 */
import { system, world } from "@minecraft/server";
import { peerIpcFromMcbe } from "@mcbe-reciperegistry/client/mcbe-ipc";
import { HOST_LOADED_MESSAGE } from "@mcbe-reciperegistry/client";
import {
  attachPersist,
  createCatalog,
  createRegistryHost,
  attachIpcHost,
  transportFromSystem,
  VANILLA_ITEM_TAGS,
  hydrateCatalogJob,
} from "../src/index.js";
import { VANILLA_CATALOG_MINECRAFT, VANILLA_RECIPES } from "../src/vanillaCatalog.js";

/** Subscribes to schema-3 IPC + JSON discovery, then hydrates vanilla/overlay and broadcasts `ready`. */
export function startRecipeRegistryHost(): void {
  const catalog = createCatalog();
  const persist = attachPersist(catalog, world, {
    runTimeout(callback, ticks) {
      system.runTimeout(callback, ticks);
    },
  });

  const transport = transportFromSystem(system);
  const host = createRegistryHost({
    send: transport.send,
    minecraft: VANILLA_CATALOG_MINECRAFT,
  });
  attachIpcHost({
    ipc: peerIpcFromMcbe(),
    catalog,
    tagIndex: VANILLA_ITEM_TAGS,
    minecraft: VANILLA_CATALOG_MINECRAFT,
    persist,
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
        yield* hydrateCatalogJob(catalog, VANILLA_RECIPES, persist);
        host.broadcastReady();
        console.log(HOST_LOADED_MESSAGE);
      })(),
    );
  });
}
