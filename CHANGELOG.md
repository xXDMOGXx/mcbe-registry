# @mcbab-mods/bedrock-registry

## 2.0.0

### Major Changes

- bb31ed6: Schema 5: overlay kinds travel as per-kind PROTO objects (not JSON strings). Loot `chance` is percent 0–100 (`100` = always). Schema-4 clients and hosts no longer match.

### Patch Changes

- Replace the Recipe Registry book icon with a bookshelf-end **BR** pack icon.
- 3fa7df2: Add engine-gap vanilla crafting recipes (legacy wood buttons/plates/trapdoors/signs/chest boats and stone-type slabs) that Mojang never ships as recipe JSON.
- Updated dependencies [8ecbc82]
- Updated dependencies [bb31ed6]
  - @mcbe-registry/client@2.0.0

## 1.0.0

### Major Changes

- **Bedrock Registry.** Pack-list name is Bedrock Registry. Same behavior-pack UUID as Recipe Registry (`33303c67-a05d-4964-b2c3-ba7c42d8d3b6`); worlds that already depend on that UUID keep working. Manifest version is `[1, 0, 0]`.
- **Schema 4.** Catalog traffic is `bedrockregistry.*` (IPC + JSON hello/ready). Schema 3 `@mcbe-reciperegistry/client` / `reciperegistry.*` gets no replies. Leftover `reciperegistry:` dynamic properties are left in the world and ignored.
- **Multi-kind catalog.** Packs, recipes, items, blocks, entities, fluids, gases, tags, and loot. Register and fingerprint per `(source, kind)` — an item overlay does not rewrite that pack’s recipe blob.
- **Vanilla snapshots in the host.** Recipes, water/lava, item and block tags, and entity/block loot (bedrock-samples plus an engine-gap dump). Mojang data — see `NOTICE`.
- **Public client.** `@mcbe-registry/client` (npm) and drop-in `bedrock-registry-client.js` on the Release. Docs: [client wiki](https://github.com/xXDMOGXx/mcbe-registry-client/wiki). Authors must update from `@mcbe-reciperegistry/client`.

## 0.3.0

### Minor Changes

- **Schema 3** wire: match/result/list/get/register use typed MCBE-IPC objects (not JSON-in-String). Open recipe fields (`extra` and unknown keys) still ride an `extensions` JSON string.
- **Fingerprint register:** queue with `addRecipe`, then one `register({ source })`. The client fingerprints the set, pings the host, and only sends the full list on miss — no hand-maintained `rev` / `sync`.
- Pack icon for the behavior pack listing.
- Schema-2 JSON-in-String IPC clients must update to `@mcbe-reciperegistry/client` 0.2+. Schema-1 script-event JSON still warn+serve.

## 0.2.1

### Patch Changes

- 9649296: Schema-2 host README, drop chat debug scriptevents, and attach `recipe-registry-client.js` on Release.

## 0.2.0

### Minor Changes

- Schema 2: Recipe Registry speaks MCBE-IPC for data ops, advertises schema 2, and ships with a public client package. Schema-1 JSON still works with a one-time deprecation warn.

### Patch Changes

- Updated dependencies
  - @mcbab/recipe-registry@0.2.0
  - @mcbab/build@0.1.1
