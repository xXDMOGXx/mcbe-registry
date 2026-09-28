# Bedrock Registry

A **shared catalog** for Minecraft Bedrock addons. It does not place blocks, open screens, or craft items. Other packs register documents (items, blocks, recipes, fluids, tags, loot, …) and query them.

Use [@mcbe-registry/client](https://www.npmjs.com/package/@mcbe-registry/client). Full author docs: [client wiki](https://github.com/xXDMOGXx/mcbe-registry-client/wiki). A client built for a different host will not get replies.

1. Install `mcbe-ipc` from [OmniacDev/MCBE-IPC](https://github.com/OmniacDev/MCBE-IPC) in **your** pack. Each addon must ship its own copy; Bedrock will not share one file between packs. That library is how packs send messages.
2. Install `@mcbe-registry/client`, or drop `bedrock-registry-client.js` from the [client GitHub Releases](https://github.com/xXDMOGXx/mcbe-registry-client/releases) into your pack (pre-built client script).

`waitReady()` is `false` when the host is missing, slow, or not a match for this client.

Vanilla Minecraft documents already ship in the host. Do not register those again.

## Install the host (once)

1. The player imports **one** Bedrock Registry behavior pack from [GitHub Releases](https://github.com/xXDMOGXx/mcbe-registry/releases) (the `.mcaddon`) or [CurseForge](https://www.curseforge.com/minecraft-bedrock/addons/bedrock-registry).
2. Enable **Bedrock Registry** on the world. There is no resource pack.
3. Your addon lists that pack as a **dependency**.

**Behavior pack UUID:** `33303c67-a05d-4964-b2c3-ba7c42d8d3b6`

Set `version` to the installed host as `[major, minor, patch]`.

## Trust

Any enabled script can register any document. If `waitReady` is false or a call times out, treat the catalog as unavailable.