/**
 * Zips `dist/BP` into `dist/bedrock-registry.mcaddon`. Does not run esbuild.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Writes `dist/bedrock-registry.mcaddon` with a `BP/` root. */
export function packageBedrockRegistryPack(modDir = packRoot): string {
  const bpDir = path.join(modDir, "dist", "BP");
  if (!fs.existsSync(bpDir)) {
    throw new Error(`Missing dist/BP for ${modDir} — run \`pnpm build\` first.`);
  }
  const outPath = path.join(modDir, "dist", "bedrock-registry.mcaddon");
  fs.rmSync(outPath, { force: true });
  const zip = spawnSync(
    "python3",
    [
      "-c",
      "import pathlib, sys, zipfile\n" +
        "bp, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])\n" +
        "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:\n" +
        "  for p in bp.rglob('*'):\n" +
        "    if p.is_file():\n" +
        "      z.write(p, pathlib.Path('BP') / p.relative_to(bp))\n",
      bpDir,
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (zip.status !== 0) {
    throw new Error(zip.stderr || zip.stdout || "python3 zip failed");
  }
  console.log(`Packaged bedrock-registry -> ${outPath}`);
  return outPath;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    packageBedrockRegistryPack(packRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
