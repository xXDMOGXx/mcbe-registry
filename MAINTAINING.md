# Maintainer notes (not for addon authors)

Public repo: https://github.com/xXDMOGXx/mcbe-registry

Author-facing client docs: https://github.com/xXDMOGXx/mcbe-reciperegistry-client/wiki

Develop in MCBAB `mods/recipe-registry`. Mirror per `satellite/README.md`.

## npm trusted publishing (`@mcbe-registry/host`)

Workflow: `.github/workflows/publish.yml` (OIDC — no `NPM_TOKEN`).

**First publish** cannot use OIDC until the package exists. Create npm org `mcbe-registry`, `npm login --auth-type=web`, then `npm publish --access public` from a public checkout at `0.3.0`. After that, one-time:

```bash
npm login --auth-type=web
npm trust github @mcbe-registry/host \
  --file publish.yml \
  --repo xXDMOGXx/mcbe-registry \
  --allow-publish \
  -y
```

Or: npmjs.com → package → Settings → Trusted Publisher → GitHub Actions
(`xXDMOGXx` / `mcbe-registry` / `publish.yml`).

Do not tag `v*` until that first local publish (or trust) is done, or the workflow will 403.

Vanilla snapshots in `src/vanillaCatalog.ts` / `src/vanillaItemTags.ts` are Mojang data (`NOTICE`). Do not mark them MIT.

## GitHub Release (`.mcaddon`)

Tag `vX.Y.Z` matching `package.json` `version`. Workflow `release.yml` builds the pack zip. Attach or link `@mcbe-reciperegistry/client` drop-in JS from that satellite's Releases. Do not vendor Omniac `mcbe-ipc`.

CurseForge upload stays on the private MCBAB `release-registry` workflow.

## Vanilla snapshot

`pnpm sample-regen` / `npm run sample-regen` fetches Mojang `bedrock-samples` and rewrites the snapshot files if `version.json` changed. Leaves a dirty tree; commit separately.
