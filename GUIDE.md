# Recipe Registry protocol guide

This pack is a **shared recipe catalog**. It does not place blocks, open screens, or craft items. Other behavior packs tell it which recipes exist, then ask “does this grid/bag match?” and “what would that yield?”

## Schema 3 (current)

**Use** [`@mcbe-reciperegistry/client`](https://www.npmjs.com/package/@mcbe-reciperegistry/client). Hand-rolled JSON data RPC (`reciperegistry:match` / `result` / … with `{ "v": 1 }`) is **removed** — the host does not reply.

1. Enable this host pack (BP UUID below).
2. Install **`mcbe-ipc`** from [OmniacDev/MCBE-IPC](https://github.com/OmniacDev/MCBE-IPC) (npm dependency of the client; for copy-paste packs, follow Omniac’s install notes — each pack isolate needs its own copy).
3. Install **`@mcbe-reciperegistry/client`** (npm) or drop the Release `recipe-registry-client.js` into your pack.

```ts
import { createBedrockClient } from "@mcbe-reciperegistry/client/bedrock";

const registry = createBedrockClient(5);
if (!(await registry.waitReady())) {
  // host missing or schema mismatch — fail closed for catalog lookups
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

- **Data ops** (`match`, `result`, `get`, `list`, `register`, `unregister`) use **MCBE-IPC** with **typed PROTO** (not JSON-in-`String`).
- **Discovery** still uses JSON `reciperegistry:ready` / `hello` with **`schema: 3`**, and an IPC hello on `reciperegistry.hello`.
- **Register:** `addRecipe` × N, then one `register({ source })`. The client fingerprints the pending set, pings the host, and only sends the full list on miss. No public `sync` / hand `rev`.
- `waitReady` compares that numeric `schema` (fallback `v`) to the client. Lower → host pack is outdated. Higher → this addon is outdated. Missing host → timeout (~5s). Schema-2 JSON-in-String IPC clients fail closed (schema mismatch).
- After the host actually starts, the content log / BDS log can show `Recipe Registry has successfully loaded` (`console.log`; Inform, not the in-game content-log GUI unless that GUI is Info/Verbose). Digitally Networked Storage logs `Digitally Networked Storage has successfully loaded` the same way. If hello fails it `console.warn`s `Digitally Networked Storage unable to communicate with Recipe Registry` and also sends that line in yellow chat. Schema mismatch uses the same warn+chat pattern. Existing patterns still run; Pattern Printer crafting lookup does not.
- Wire details: channel names in the client package. Author-facing docs: client wiki [Home](https://github.com/xXDMOGXx/mcbe-reciperegistry-client/wiki).

## Install the host (once)

1. The player imports **one** Recipe Registry behavior pack ([mcbe-registry](https://github.com/xXDMOGXx/mcbe-registry) Release `.mcaddon`).
2. Enable **recipe-registry (BP)** on the world. There is no resource pack.
3. Your addon lists that pack as a **dependency**. Bedrock will not download it for you.

**Behavior pack UUID** (your `manifest.json` `dependencies` entry):

`33303c67-a05d-4964-b2c3-ba7c42d8d3b6`

Match `version` to the installed host (for host `0.3.0` that is `[0, 3, 0]`).

**Do not** copy this pack’s scripts into yours. Two hosts in one world are unsupported. A second addon that depends on the same UUID reuses the one import.

## Matching (bag vs shaped)

- **Station** = a **block id** (`minecraft:crafting_table`, `minecraft:furnace`, `mymod:crusher`). Recipes name one or more stations. Asks always include exactly one station.
- Occupied **grid** or `pattern`+`key` is shaped (translate in the 3×3, plus mirror).
- `inputs` only is a bag (same expanded length, tags allowed). Empty query matches nothing.
- Vanilla recipes ship inside the host. You do not register sticks or furnace beef.

## Trust and failure

Trust-all: any enabled script can register any result. If `waitReady` is false or a data op times out, treat the registry as unavailable — do not invent a craft.
