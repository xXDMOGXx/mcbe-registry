# @mcbab-mods/recipe-registry

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
