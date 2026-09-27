import {
  CHANNEL,
  PROTOCOL_SCHEMA,
  advertisedSchema,
  canonicalizeRecipes,
  decodeMatchQuery,
  decodeRecipe,
  encodeListEntry,
  encodeMatchResult,
  encodeRecipe,
  noteHostNeedsUpdate,
  Proto,
  type PeerIpc,
  type Recipe,
} from "@mcbe-reciperegistry/client";
import type { Catalog } from "./catalog.js";
import type { TagIndex } from "./match.js";
import type { PersistHooks } from "./persist.js";
import { isValidSource } from "./sourceStore.js";

function isFingerprintPing(payload: { source?: string; fp?: string; recipes: unknown[] }): boolean {
  return payload.source !== undefined && payload.fp !== undefined && payload.recipes.length === 0;
}

/**
 * Registers schema-3 MCBE-IPC handlers against `catalog`.
 * Returns an unsubscribe that removes every handler.
 */
export function attachIpcHost(options: {
  ipc: PeerIpc;
  catalog: Catalog;
  tagIndex?: TagIndex;
  minecraft?: string;
  persist?: PersistHooks;
  /** Extra sink for newer-client hello (chat). `noteHostNeedsUpdate` still `console.warn`s. */
  onNewerClient?: (message: string) => void;
}): () => void {
  const unsubs: (() => void)[] = [];

  unsubs.push(
    options.ipc.handle(CHANNEL.hello, Proto.Hello, Proto.Hello, (ask) => {
      const seen = advertisedSchema(ask);
      if (seen !== undefined && seen > PROTOCOL_SCHEMA) {
        noteHostNeedsUpdate((message) => {
          console.warn(message);
          options.onNewerClient?.(message);
        });
      }
      const reply: { schema: number; minecraft?: string } = { schema: PROTOCOL_SCHEMA };
      if (options.minecraft !== undefined) reply.minecraft = options.minecraft;
      return reply;
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.register, Proto.RegisterAsk, Proto.OkReply, (payload) => {
      if (isFingerprintPing(payload) && payload.source !== undefined && payload.fp !== undefined) {
        if (!isValidSource(payload.source)) return { ok: false, err: "bad" };
        const persist = options.persist;
        if (persist !== undefined && persist.fpOf(payload.source) === payload.fp && persist.hydrateSource(payload.source)) {
          persist.heard(payload.source);
          return { ok: true };
        }
        return { ok: false, err: "fp" };
      }

      const recipes = payload.recipes.map(decodeRecipe);
      if (typeof payload.source === "string") {
        if (!isValidSource(payload.source)) return { ok: false, err: "bad" };
        const fp = payload.fp ?? canonicalizeRecipes(recipes);
        const stolen = options.catalog.replaceSource(payload.source, recipes);
        options.persist?.save(payload.source, fp);
        options.persist?.heard(payload.source);
        for (const other of stolen) {
          const otherFp = options.persist?.fpOf(other) ?? canonicalizeRecipes(options.catalog.recipesForSource(other));
          options.persist?.save(other, otherFp);
        }
        return { ok: true };
      }

      for (const recipe of recipes) {
        const previousSource = options.catalog.sourceOf(recipe.id);
        options.catalog.register(recipe);
        if (previousSource !== undefined) {
          const otherFp =
            options.persist?.fpOf(previousSource) ??
            canonicalizeRecipes(options.catalog.recipesForSource(previousSource));
          options.persist?.save(previousSource, otherFp);
        }
      }
      return { ok: true };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.unregister, Proto.UnregisterAsk, Proto.OkReply, (body) => {
      const affected = new Set<string>();
      for (const id of body.ids) {
        const previousSource = options.catalog.sourceOf(id);
        if (previousSource !== undefined) affected.add(previousSource);
        options.catalog.unregister(id);
      }
      for (const source of affected) {
        const fp = options.persist?.fpOf(source) ?? canonicalizeRecipes(options.catalog.recipesForSource(source));
        options.persist?.save(source, fp);
      }
      return { ok: true };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.match, Proto.MatchQuery, Proto.MatchReply, (wire) => {
      const query = decodeMatchQuery(wire);
      const ids = options.catalog.matchIds(query, options.tagIndex);
      return ids.length > 0 ? { ids } : { ids: undefined };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.result, Proto.MatchQuery, Proto.ResultReply, (wire) => {
      const query = decodeMatchQuery(wire);
      const results = options.catalog.matchResults(query, options.tagIndex).map(encodeMatchResult);
      return results.length > 0 ? { results } : { results: undefined };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.get, Proto.GetAsk, Proto.GetReply, (body) => {
      const recipe = options.catalog.get(body.id);
      return { recipe: recipe !== undefined ? encodeRecipe(recipe) : undefined };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.list, Proto.ListFilter, Proto.ListReply, (body) => {
      const filter =
        body.station !== undefined || body.output !== undefined || body.leftover !== undefined
          ? {
              station: body.station,
              output: body.output,
              leftover: body.leftover,
            }
          : undefined;
      return { entries: options.catalog.list(filter).map(encodeListEntry) };
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

/** Re-export for tests that build Recipe documents. */
export type { Recipe };
