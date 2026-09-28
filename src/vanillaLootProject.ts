import fs from "node:fs";
import path from "node:path";
import type { LootDocument, LootEntry } from "@mcbe-registry/client";
import { parseSamplesJson } from "./samplesJson.js";
import { VANILLA_LOOT_DUMP } from "./vanillaLootDump.js";
import { mergeLootJsonThenDump } from "./vanillaSnapshotMerge.js";

function qualifyMinecraft(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

function lootTablePath(name: string, packRoot: string): string | undefined {
  let rel = name.replace(/^minecraft:/, "");
  if (!rel.startsWith("loot_tables/")) rel = `loot_tables/${rel}`;
  if (!rel.endsWith(".json")) rel += ".json";
  const full = path.join(packRoot, rel);
  return fs.existsSync(full) ? full : undefined;
}

function walkJsonFiles(dir: string, into: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkJsonFiles(full, into);
    else if (name.endsWith(".json")) into.push(full);
  }
}

function addLeaf(into: Map<string, LootEntry>, entry: LootEntry): void {
  const key = entry.item ?? entry.tag ?? entry.fluid ?? entry.gas;
  if (key === undefined) return;
  const prefix = entry.item !== undefined ? "i" : entry.tag !== undefined ? "t" : entry.fluid !== undefined ? "f" : "g";
  into.set(`${prefix}:${key}`, entry);
}

function collectFromNode(
  node: unknown,
  packRoot: string,
  into: Map<string, LootEntry>,
  seen: Set<string>,
): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return;
  const row = node as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : undefined;
  const name = typeof row.name === "string" ? row.name : undefined;
  if (type === "loot_table" && name !== undefined) {
    const nested = lootTablePath(name, packRoot);
    if (nested !== undefined) collectFromFile(nested, packRoot, into, seen);
  } else if (name !== undefined && type !== "empty") {
    if (type === "item" || type === undefined) addLeaf(into, { item: qualifyMinecraft(name) });
    else if (type === "tag") addLeaf(into, { tag: qualifyMinecraft(name) });
  }
  if (Array.isArray(row.entries)) {
    for (const child of row.entries) collectFromNode(child, packRoot, into, seen);
  }
  if (Array.isArray(row.children)) {
    for (const child of row.children) collectFromNode(child, packRoot, into, seen);
  }
  if (Array.isArray(row.pools)) {
    for (const pool of row.pools) collectFromNode(pool, packRoot, into, seen);
  }
}

function collectFromFile(filePath: string, packRoot: string, into: Map<string, LootEntry>, seen: Set<string>): void {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  collectFromNode(parseSamplesJson(filePath), packRoot, into, seen);
}

/** Compact catalog document from one Mojang loot-table JSON file. */
export function projectLootFile(filePath: string, kind: "blocks" | "entities", packRoot: string): LootDocument | undefined {
  const lootRoot = path.join(packRoot, "loot_tables", kind);
  const rel = path.relative(lootRoot, filePath).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel.length === 0) return undefined;
  const idRel = rel.replace(/\.json$/, "");
  const stem = path.basename(idRel);
  const into = new Map<string, LootEntry>();
  collectFromFile(filePath, packRoot, into, new Set());
  const entries = [...into.values()].sort((a, b) => {
    const ak = a.item ?? a.tag ?? a.fluid ?? a.gas ?? "";
    const bk = b.item ?? b.tag ?? b.fluid ?? b.gas ?? "";
    return ak.localeCompare(bk);
  });
  if (entries.length === 0) return undefined;
  const document: LootDocument = {
    id: `minecraft:${kind}/${idRel}`,
    entries,
  };
  if (kind === "blocks") document.block = qualifyMinecraft(stem);
  else document.entity = qualifyMinecraft(stem);
  return document;
}

/** Entity and block loot tables under `behavior_pack/loot_tables` only. */
export function loadVanillaLootJson(packRoot: string): LootDocument[] {
  const out: LootDocument[] = [];
  for (const kind of ["blocks", "entities"] as const) {
    const dir = path.join(packRoot, "loot_tables", kind);
    const files: string[] = [];
    walkJsonFiles(dir, files);
    files.sort();
    for (const filePath of files) {
      const document = projectLootFile(filePath, kind, packRoot);
      if (document !== undefined) out.push(document);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Samples loot JSON, then engine-gap dump rows whose ids are not in those files. */
export function loadVanillaLoot(packRoot: string, dump: readonly LootDocument[] = VANILLA_LOOT_DUMP): LootDocument[] {
  return mergeLootJsonThenDump(loadVanillaLootJson(packRoot), dump);
}
