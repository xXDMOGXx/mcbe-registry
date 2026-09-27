# Recipe Registry

A script-only Minecraft Bedrock behavior pack. It is a **recipe catalog**, not a crafter: no blocks, items, or screens. Other addons ask it which recipes match a station and inputs, and what those recipes yield.

This pack is a shared host. Import it once for CurseForge/GitHub stacked worlds. Digitally Networked Storage’s Marketplace zip inlines the same host; if both are enabled, the first world-DP claim wins and the other pack is a client.

Requires Minecraft Bedrock **1.21.100+** and stable Script API `@minecraft/server` **2.8.0** (no Beta APIs experiment). Current wire is **schema 3**.

## Install

1. Download `recipe-registry-x.y.z.mcaddon` from [GitHub Releases](https://github.com/xXDMOGXx/mcbe-registry/releases) (client drop-in JS is on [`@mcbe-reciperegistry/client` Releases](https://github.com/xXDMOGXx/mcbe-reciperegistry-client/releases)), or from [CurseForge](https://www.curseforge.com/minecraft-bedrock/addons/recipe-registry).
2. Open it (or copy the behavior pack into `development_behavior_packs` / the world’s pack list).
3. Enable **recipe-registry (BP)** on the world.

There is no resource pack.

Vanilla catalog snapshots in this pack (`src/vanillaCatalog.ts`, `src/vanillaItemTags.ts`) are Mojang data, not MIT — see `NOTICE`. Source: [xXDMOGXx/mcbe-registry](https://github.com/xXDMOGXx/mcbe-registry) (MIT except that snapshot). Fork and rebuild for your own world; this tree is not a contribution project.

## For other addons

**Prefer** [`@mcbe-reciperegistry/client`](https://www.npmjs.com/package/@mcbe-reciperegistry/client) over hand-rolled JSON.

- Docs: [client wiki](https://github.com/xXDMOGXx/mcbe-reciperegistry-client/wiki)
- npm: `npm install @mcbe-reciperegistry/client mcbe-ipc`
- Drop-in JS: `recipe-registry-client.js` on this Release (or the [client Releases](https://github.com/xXDMOGXx/mcbe-reciperegistry-client/releases)); place Omniac’s module beside it as `mcbe-ipc.js`

**Behavior pack UUID** (manifest `dependencies` entry): `33303c67-a05d-4964-b2c3-ba7c42d8d3b6`

Match the `version` to this release’s pack version (for host `0.3.0` that is `[0, 3, 0]`).

Bedrock will not download this pack for you. The player must import it once. A second mod that depends on the same UUID reuses that one import — no duplicates.

Do not embed a second host that skips the claim protocol. Two hosts without election are unsupported.

### Quick example (schema 3)

```ts
import { createBedrockClient } from "@mcbe-reciperegistry/client/bedrock";
// or: import { createBedrockClient } from "./recipe-registry-client.js";

const registry = createBedrockClient(5);
if (!(await registry.waitReady())) {
  // host missing or schema mismatch — fail closed
} else {
  registry.clearRecipes();
  registry.addRecipe({
    id: "mymod:crush_cobble",
    stations: ["mymod:crusher"],
    inputs: ["minecraft:cobblestone"],
    outputs: ["minecraft:gravel"],
  });
  await registry.register({ source: "mymod" });

  const yields = await registry.result({
    station: "minecraft:furnace",
    inputs: ["minecraft:beef"],
  });
}
```

Data ops use **MCBE-IPC** with typed PROTO. Discovery still uses JSON `reciperegistry:ready` / `hello` with **`schema: 3`**. Register with `addRecipe` × N then one `register({ source })` (fingerprint ping; no public `sync` / hand `rev`).

Schema-1 JSON data RPC is **removed** (no catalog reply). Schema-2 JSON-in-String IPC is unsupported. Wire details: [GUIDE.md](./GUIDE.md).

## Trust

Any enabled script can register any result. Recipe ids should be namespaced (`mymod:…`).
