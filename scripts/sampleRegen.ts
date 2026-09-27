/**
 * Fetches Mojang `bedrock-samples` and rewrites the committed vanilla snapshot
 * when `version.json` is newer than `VANILLA_CATALOG_MINECRAFT`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMinecraftVersion, writeVanillaSnapshot } from "./regen-vanilla-catalog.js";

/** Mojang `bedrock-samples` git remote. */
export const BEDROCK_SAMPLES_REMOTE = "https://github.com/Mojang/bedrock-samples.git";

/** `export const VANILLA_CATALOG_MINECRAFT = "…"` in `vanillaCatalog.ts`. */
const CATALOG_VERSION = /export const VANILLA_CATALOG_MINECRAFT = "([^"]+)"/;

/** Snapshot Minecraft label from `vanillaCatalog.ts` source. */
export function catalogMinecraftFromSource(source: string): string {
  const match = CATALOG_VERSION.exec(source);
  if (match === null) throw new Error("VANILLA_CATALOG_MINECRAFT missing from vanillaCatalog.ts");
  return match[1]!;
}

/** True when samples `latest.version` is not the committed snapshot label. */
export function snapshotNeedsRegen(samplesVersion: string, catalogVersion: string): boolean {
  return samplesVersion !== catalogVersion;
}

/** Cache dir for a shallow `bedrock-samples` clone (not in git). */
export function samplesCacheDir(): string {
  return path.join(os.tmpdir(), "mcbab-bedrock-samples");
}

/** Shallow clone or `fetch` + `reset --hard origin/main`. */
export function syncBedrockSamples(dest = samplesCacheDir()): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(path.join(dest, ".git"))) {
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    execFileSync("git", ["clone", "--depth", "1", "--branch", "main", BEDROCK_SAMPLES_REMOTE, dest], {
      stdio: "inherit",
    });
  } else {
    execFileSync("git", ["-C", dest, "fetch", "--depth", "1", "origin", "main"], { stdio: "inherit" });
    execFileSync("git", ["-C", dest, "reset", "--hard", "origin/main"], { stdio: "inherit" });
  }
  return dest;
}

/** Fetches samples and writes the snapshot files when the Minecraft version changed. */
export async function sampleRegen(options?: {
  catalogPath?: string;
  sync?: () => string;
}): Promise<"skipped" | "wrote"> {
  const catalogPath =
    options?.catalogPath ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/vanillaCatalog.ts");
  const catalogVersion = catalogMinecraftFromSource(fs.readFileSync(catalogPath, "utf8"));
  const dest = (options?.sync ?? syncBedrockSamples)();
  const samplesVersion = readMinecraftVersion(dest);
  if (!snapshotNeedsRegen(samplesVersion, catalogVersion)) {
    console.log(`Vanilla snapshot already ${catalogVersion}`);
    return "skipped";
  }
  console.log(`Samples ${samplesVersion} ≠ snapshot ${catalogVersion}; regenerating`);
  await writeVanillaSnapshot(dest);
  return "wrote";
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  sampleRegen().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
