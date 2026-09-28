import {
  CHANNEL,
  DEFAULT_REGISTRY_KIND,
  PROTOCOL_SCHEMA,
  advertisedSchema,
  canonicalizeDocuments,
  canonicalizeRecipes,
  decodeMatchQuery,
  decodeRecipe,
  encodeListEntry,
  encodeMatchResult,
  encodeRecipe,
  isRegistryKind,
  noteHostNeedsUpdate,
  Proto,
  type PeerIpc,
  type Recipe,
} from "@mcbe-registry/client";
import type { Catalog } from "./catalog.js";
import { documentHasBadAmount } from "./catalog.js";
import type { PersistDropHooks, PersistHooks } from "./persist.js";
import { isValidSource } from "./sourceStore.js";

function isFingerprintPing(payload: {
  source?: string;
  fp?: string;
  recipes: unknown[];
  documents?: string[];
}): boolean {
  const docs = payload.documents ?? [];
  return payload.source !== undefined && payload.fp !== undefined && payload.recipes.length === 0 && docs.length === 0;
}

function fingerprintOf(kind: string, documents: readonly unknown[]): string {
  if (kind === DEFAULT_REGISTRY_KIND) return canonicalizeRecipes(documents as Recipe[]);
  const withIds = documents.filter(
    (d): d is { id: string } => typeof d === "object" && d !== null && typeof (d as { id?: unknown }).id === "string",
  );
  return canonicalizeDocuments(withIds);
}

function documentHasStation(document: unknown, station: string): boolean {
  if (typeof document !== "object" || document === null) return false;
  const stations = (document as { stations?: unknown }).stations;
  return Array.isArray(stations) && stations.includes(station);
}

function parseDocuments(raw: string[] | undefined): unknown[] {
  if (raw === undefined) return [];
  const out: unknown[] = [];
  for (const row of raw) {
    try {
      out.push(JSON.parse(row) as unknown);
    } catch {
      /* skip malformed document */
    }
  }
  return out;
}

/**
 * Registers schema-4 MCBE-IPC handlers against `catalog`.
 * Returns an unsubscribe that removes every handler.
 */
export function attachIpcHost(options: {
  ipc: PeerIpc;
  catalog: Catalog;
  minecraft?: string;
  persist?: PersistHooks;
  dropHooks?: PersistDropHooks;
  /** Extra sink for newer-client hello (chat). `noteHostNeedsUpdate` still `console.warn`s. */
  onNewerClient?: (message: string) => void;
}): () => void {
  const unsubs: (() => void)[] = [];
  const subscribers = new Map<string, number>();

  function sendUpdated(event: { kind: string; source?: string; dropped?: boolean }): void {
    if ((subscribers.get(event.kind) ?? 0) < 1) return;
    options.ipc.send(CHANNEL.updated, Proto.KindUpdated, event);
  }

  if (options.dropHooks !== undefined) {
    options.dropHooks.onDropped = (source, kinds) => {
      for (const kind of kinds) sendUpdated({ kind, source, dropped: true });
    };
  }

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
      const kind = payload.kind ?? DEFAULT_REGISTRY_KIND;
      if (!isRegistryKind(kind)) return { ok: false, err: "bad" };

      if (isFingerprintPing(payload) && payload.source !== undefined && payload.fp !== undefined) {
        if (!isValidSource(payload.source)) return { ok: false, err: "bad" };
        const persist = options.persist;
        if (
          persist !== undefined &&
          persist.fpOf(payload.source, kind) === payload.fp &&
          persist.hydrateSource(payload.source, kind)
        ) {
          persist.heard(payload.source);
          return { ok: true };
        }
        return { ok: false, err: "fp" };
      }

      const documents =
        kind === DEFAULT_REGISTRY_KIND ? payload.recipes.map(decodeRecipe) : parseDocuments(payload.documents);
      for (const document of documents) {
        if (documentHasBadAmount(kind, document)) return { ok: false, err: "bad" };
      }
      if (typeof payload.source === "string") {
        if (!isValidSource(payload.source)) return { ok: false, err: "bad" };
        const fp = payload.fp ?? fingerprintOf(kind, documents);
        const stolen = options.catalog.replaceSource(payload.source, documents, kind);
        options.persist?.save(payload.source, fp, kind);
        options.persist?.heard(payload.source);
        for (const other of stolen) {
          const otherDocs = options.catalog.documentsForSource(other, kind);
          options.persist?.save(other, fingerprintOf(kind, otherDocs), kind);
          sendUpdated({ kind, source: other });
        }
        sendUpdated({ kind, source: payload.source });
        return { ok: true };
      }

      for (const document of documents) {
        const id =
          typeof document === "object" && document !== null && typeof (document as { id?: unknown }).id === "string"
            ? (document as { id: string }).id
            : undefined;
        const previousSource = id !== undefined ? options.catalog.sourceOfDocument(kind, id) : undefined;
        options.catalog.registerDocument(kind, document);
        if (previousSource !== undefined) {
          const otherDocs = options.catalog.documentsForSource(previousSource, kind);
          options.persist?.save(previousSource, fingerprintOf(kind, otherDocs), kind);
        }
      }
      sendUpdated({ kind });
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
        const remaining = options.catalog.recipesForSource(source);
        options.persist?.save(source, fingerprintOf(DEFAULT_REGISTRY_KIND, remaining), DEFAULT_REGISTRY_KIND);
        if (remaining.length === 0) sendUpdated({ kind: DEFAULT_REGISTRY_KIND, source, dropped: true });
        else sendUpdated({ kind: DEFAULT_REGISTRY_KIND, source });
      }
      return { ok: true };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.match, Proto.MatchQuery, Proto.MatchReply, (wire) => {
      const query = decodeMatchQuery(wire);
      const ids = options.catalog.matchIds(query);
      return ids.length > 0 ? { ids } : { ids: undefined };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.result, Proto.MatchQuery, Proto.ResultReply, (wire) => {
      const query = decodeMatchQuery(wire);
      const results = options.catalog.matchResults(query).map(encodeMatchResult);
      return results.length > 0 ? { results } : { results: undefined };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.get, Proto.GetAsk, Proto.GetReply, (body) => {
      const kind = body.kind ?? DEFAULT_REGISTRY_KIND;
      let recipe: ReturnType<typeof encodeRecipe> | undefined;
      let document: string | undefined;
      if (isRegistryKind(kind) && kind === DEFAULT_REGISTRY_KIND) {
        const stored = options.catalog.get(body.id);
        if (stored !== undefined) recipe = encodeRecipe(stored);
      } else if (isRegistryKind(kind)) {
        const stored = options.catalog.getDocument(kind, body.id);
        if (stored !== undefined) document = JSON.stringify(stored);
      }
      return { recipe, document };
    }),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.list, Proto.ListFilter, Proto.ListReply, ((body: {
      kind: string | undefined;
      station: string | undefined;
      output: string | undefined;
      leftover: string | undefined;
      input: string | undefined;
      source: string | undefined;
      vanilla: boolean | undefined;
      namespace: string | undefined;
      creator: string | undefined;
      displayName: string | undefined;
      domain: string | undefined;
      id: string | undefined;
      entity: string | undefined;
      block: string | undefined;
      tool: string | undefined;
      item: string | undefined;
      fluid: string | undefined;
      gas: string | undefined;
    }) => {
      const kind = body.kind ?? DEFAULT_REGISTRY_KIND;
      if (!isRegistryKind(kind)) return { entries: [], documents: undefined, sources: undefined };
      const overlay = body.vanilla === false || body.source !== undefined;
      if (overlay) {
        const names =
          body.source !== undefined ? (isValidSource(body.source) ? [body.source] : []) : options.catalog.overlaySources(kind);
        const documents: string[] = [];
        const sources: string[] = [];
        for (const source of names) {
          let docs = options.catalog.documentsForSource(source, kind);
          if (kind === DEFAULT_REGISTRY_KIND && body.station !== undefined) {
            docs = docs.filter((doc) => documentHasStation(doc, body.station as string));
          }
          for (const doc of docs) {
            documents.push(JSON.stringify(doc));
            sources.push(source);
          }
        }
        return { entries: [], documents, sources };
      }
      const filter = {
        station: body.station,
        output: body.output,
        leftover: body.leftover,
        input: body.input,
        namespace: body.namespace,
        creator: body.creator,
        displayName: body.displayName,
        domain: body.domain,
        id: body.id,
        entity: body.entity,
        block: body.block,
        tool: body.tool,
        item: body.item,
        fluid: body.fluid,
        gas: body.gas,
      };
      let entries: ReturnType<typeof encodeListEntry>[] = [];
      let documents: string[] | undefined;
      if (kind !== DEFAULT_REGISTRY_KIND) {
        documents = options.catalog.listDocuments(kind, filter).map((doc) => JSON.stringify(doc));
      } else {
        entries = options.catalog.list(filter).map(encodeListEntry);
      }
      return { entries, documents, sources: undefined };
    }) as never),
  );

  unsubs.push(
    options.ipc.handle(CHANNEL.subscribe, Proto.SubscribeAsk, Proto.OkReply, (ask) => {
      const kinds = ask.kinds.filter(isRegistryKind);
      for (const kind of kinds) subscribers.set(kind, (subscribers.get(kind) ?? 0) + 1);
      return { ok: true };
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

/** Re-export for tests that build Recipe documents. */
export type { Recipe };
