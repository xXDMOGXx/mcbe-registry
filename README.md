# Bedrock Registry

A script-only Minecraft Bedrock behavior pack. It is a **catalog**, not a crafter: no blocks, items, or screens of its own. Other addons register and query items, blocks, recipes, fluids, tags, loot, and related documents.

Requires Minecraft Bedrock **1.21.100+** and stable Script API `@minecraft/server` **2.8.0** (no Beta APIs experiment).

## Install

1. Download the `.mcaddon` from [GitHub Releases](https://github.com/xXDMOGXx/mcbe-registry/releases) or [CurseForge](https://www.curseforge.com/minecraft-bedrock/addons/bedrock-registry).
2. Open it (or copy the behavior pack into `development_behavior_packs` / the world’s pack list).
3. Enable **Bedrock Registry** on the world.

There is no resource pack.

Vanilla snapshots in this pack are Mojang data, not MIT — see `NOTICE`. Source: [xXDMOGXx/mcbe-registry](https://github.com/xXDMOGXx/mcbe-registry).

## For other addons

Use [@mcbe-registry/client](https://www.npmjs.com/package/@mcbe-registry/client). Docs: [client wiki](https://github.com/xXDMOGXx/mcbe-registry-client/wiki).

```bash
npm install @mcbe-registry/client mcbe-ipc
```

`mcbe-ipc` is [OmniacDev/MCBE-IPC](https://github.com/OmniacDev/MCBE-IPC) (pack-to-pack messaging). A single-file client (`bedrock-registry-client.js`) is on [the client’s GitHub Releases](https://github.com/xXDMOGXx/mcbe-registry-client/releases); save the `mcbe-ipc` pack build next to it as `mcbe-ipc.js`.

**Behavior pack UUID** (manifest `dependencies` only if your addon cannot function without the catalog): `33303c67-a05d-4964-b2c3-ba7c42d8d3b6`

Any enabled script can register any document. Ids should be namespaced (`mymod:…`).