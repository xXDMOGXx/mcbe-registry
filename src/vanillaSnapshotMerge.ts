import type { LootDocument, LootEntry } from "@mcbe-registry/client";
import type { TagIndex } from "./match.js";

/** Empty-hand harvest token; same string as client `LOOT_TOOL_NONE`. */
const HARVEST_NONE = "none";

/** Merges tag maps; later maps add tags, they do not remove earlier ones. */
export function mergeTagMaps(maps: readonly Map<string, Set<string>>[]): TagIndex {
  const merged = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [item, tags] of map) {
      const set = merged.get(item) ?? new Set<string>();
      for (const tag of tags) set.add(tag);
      merged.set(item, set);
    }
  }
  const out: Record<string, string[]> = {};
  for (const item of [...merged.keys()].sort()) {
    out[item] = [...merged.get(item)!].sort();
  }
  return out;
}

/**
 * Adds dump tags only for ids that have no samples JSON file.
 * Samples/file-backed ids keep their merged JSON/fetch tags.
 */
export function applyEngineTagDump(
  base: TagIndex,
  dump: TagIndex,
  samplesFileIds: ReadonlySet<string>,
): TagIndex {
  const out: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(base)) out[id] = [...tags];
  for (const id of Object.keys(dump).sort()) {
    if (samplesFileIds.has(id)) continue;
    const extra = dump[id];
    if (extra === undefined || extra.length === 0) continue;
    const set = new Set(out[id] ?? []);
    for (const tag of extra) set.add(tag);
    out[id] = [...set].sort();
  }
  return out;
}

function stemOf(typeId: string): string {
  const colon = typeId.indexOf(":");
  return colon === -1 ? typeId : typeId.slice(colon + 1);
}

function entryStem(entry: LootEntry): string {
  const id = entry.item ?? entry.fluid ?? entry.gas ?? entry.tag;
  if (typeof id !== "string" || id.length === 0) return "";
  return stemOf(id);
}

/** Catalog id for a gap block drop set: `minecraft:blocks/<blockStem>/<sorted drop stems>`. */
export function lootDropDocumentId(blockId: string, entries: readonly LootEntry[]): string {
  const stems = [...new Set(entries.map(entryStem).filter((stem) => stem.length > 0))].sort();
  const base = `minecraft:blocks/${stemOf(blockId)}`;
  return stems.length === 0 ? base : `${base}/${stems.join("/")}`;
}

/** Generate skip id for one harvest token (`none` → fist path). */
export function blockLootGenerateId(blockId: string, toolToken: string): string {
  const base = `minecraft:blocks/${stemOf(blockId)}`;
  if (toolToken === HARVEST_NONE) return base;
  return `${base}/${stemOf(toolToken)}`;
}

/** Harvest tokens on a dump row (`tools`, legacy `tool`, or `none`). */
export function harvestTokensFromLootRow(row: LootDocument): string[] {
  const tools = row.tools;
  if (Array.isArray(tools) && tools.length > 0) return tools.map((token) => String(token));
  const rec = row as Record<string, unknown>;
  if (typeof rec.tool === "string" && rec.tool.length > 0) return [rec.tool];
  return [HARVEST_NONE];
}

/** Per-tool generate skip ids for a filled dump row. */
export function lootGenerateSkipIdsFromDump(row: LootDocument): string[] {
  if (row.block === undefined) return [row.id];
  return harvestTokensFromLootRow(row).map((token) => blockLootGenerateId(row.block!, token));
}

/** One document per (block, entries); `tools` unions harvest tokens. Entity rows pass through. */
export function mergeGapBlockLoot(docs: readonly LootDocument[]): LootDocument[] {
  const pass: LootDocument[] = [];
  const groups = new Map<string, { block: string; entries: LootEntry[]; tools: Set<string> }>();
  for (const row of docs) {
    if (row.entries.length === 0) continue;
    if (row.entity !== undefined || row.block === undefined) {
      pass.push(row);
      continue;
    }
    const key = `${row.block}\0${JSON.stringify(row.entries)}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { block: row.block, entries: row.entries, tools: new Set() };
      groups.set(key, group);
    }
    for (const token of harvestTokensFromLootRow(row)) group.tools.add(token);
  }
  const blocks: LootDocument[] = [...groups.values()].map((group) => ({
    id: lootDropDocumentId(group.block, group.entries),
    block: group.block,
    tools: [...group.tools].sort(),
    entries: group.entries,
  }));
  return [...pass, ...blocks].sort((a, b) => a.id.localeCompare(b.id));
}

/** Samples loot documents first; dump rows only when that id has no JSON table. */
export function mergeLootJsonThenDump(
  json: readonly LootDocument[],
  dump: readonly LootDocument[],
): LootDocument[] {
  const byId = new Map<string, LootDocument>();
  for (const row of json) byId.set(row.id, row);
  for (const row of mergeGapBlockLoot(dump)) {
    if (byId.has(row.id) || row.entries.length === 0) continue;
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
