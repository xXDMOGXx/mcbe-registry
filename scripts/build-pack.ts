/**
 * Script-only Bedrock Registry BP (manifest + esbuild). Does not import `@mcbab/build`.
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_LOCALE, packListLang, bedrockRegistryManifest } from "./packManifest.js";

const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_DEPLOY_ENV_VAR = "MCBAB_DEV_DEPLOY_PATH";

function findRepoRoot(startDir: string): string | undefined {
  let dir = startDir;
  while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return dir;
}

function loadDotEnv(startDir: string): void {
  const repoRoot = findRepoRoot(startDir);
  const envPath = repoRoot && path.join(repoRoot, ".env");
  if (!envPath || !fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function copyDir(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

/** Writes `dist/BP` for Bedrock Registry. */
export async function buildBedrockRegistryPack(modDir = packRoot): Promise<string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(modDir, "package.json"), "utf8")) as { version: string };
  const version = pkg.version;
  const bpDir = path.join(modDir, "dist", "BP");
  fs.rmSync(path.join(modDir, "dist", "BP"), { recursive: true, force: true });
  fs.rmSync(path.join(modDir, "dist", "RP"), { recursive: true, force: true });
  fs.mkdirSync(path.join(bpDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(bpDir, "texts"), { recursive: true });

  await esbuild.build({
    absWorkingDir: modDir,
    entryPoints: [path.join(modDir, "engine/index.ts")],
    outfile: path.join(bpDir, "scripts", "index.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    logLevel: "silent",
    external: ["@minecraft/server", "@minecraft/server-ui"],
  });

  fs.writeFileSync(
    path.join(bpDir, "manifest.json"),
    `${JSON.stringify(bedrockRegistryManifest(version), null, 2)}\n`,
  );
  const lang = packListLang(version);
  fs.writeFileSync(path.join(bpDir, "texts", "languages.json"), `${JSON.stringify([PACK_LOCALE], null, 2)}\n`);
  fs.writeFileSync(path.join(bpDir, "texts", `${PACK_LOCALE}.lang`), lang);
  fs.copyFileSync(path.join(modDir, "assets", "pack_icon.png"), path.join(bpDir, "pack_icon.png"));
  return bpDir;
}

function deployDev(modDir: string, deployRoot: string | undefined): void {
  if (!deployRoot || !fs.existsSync(deployRoot)) {
    console.warn(
      `Skipping dev-deploy: ${DEV_DEPLOY_ENV_VAR} is not set or does not exist. Build output is still available at ${path.join(modDir, "dist")}.`,
    );
    return;
  }
  const modName = path.basename(modDir);
  copyDir(path.join(modDir, "dist", "BP"), path.join(deployRoot, "development_behavior_packs", modName));
  fs.rmSync(path.join(deployRoot, "development_resource_packs", modName), { recursive: true, force: true });
  console.log(`Deployed ${modName} to ${deployRoot}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const deploy = process.argv.includes("--dev");
  if (deploy) loadDotEnv(packRoot);
  buildBedrockRegistryPack(packRoot)
    .then(() => {
      if (deploy) deployDev(packRoot, process.env[DEV_DEPLOY_ENV_VAR]);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
