/**
 * pure: dump tables are DCE'd unless MCBAB_REGISTRY_DUMP=1.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { ENGINE_DUMP_LOG_BEGIN } from "../src/vanillaEngineDumpJob.js";
import { registryDumpDefines } from "../scripts/build-pack.js";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "vanillaEngineDumpGate.ts");

async function bundle(dumpOn: boolean): Promise<string> {
  const prev = process.env.MCBAB_REGISTRY_DUMP;
  if (dumpOn) process.env.MCBAB_REGISTRY_DUMP = "1";
  else delete process.env.MCBAB_REGISTRY_DUMP;
  const outfile = path.join(os.tmpdir(), `registry-dump-gate-${process.pid}-${dumpOn ? "on" : "off"}.js`);
  try {
    await esbuild.build({
      absWorkingDir: path.dirname(entry),
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      target: "es2022",
      logLevel: "silent",
      external: ["@minecraft/server", "@minecraft/server-ui"],
      define: registryDumpDefines(),
    });
    return fs.readFileSync(outfile, "utf8");
  } finally {
    fs.rmSync(outfile, { force: true });
    if (prev === undefined) delete process.env.MCBAB_REGISTRY_DUMP;
    else process.env.MCBAB_REGISTRY_DUMP = prev;
  }
}

describe("maybeAttachVanillaEngineDump", () => {
  afterEach(() => {
    delete process.env.MCBAB_REGISTRY_DUMP;
  });

  it("omits dump log prefixes from the bundle when dump is off", async () => {
    const js = await bundle(false);
    expect(js).not.toContain(ENGINE_DUMP_LOG_BEGIN);
  });

  it("keeps dump log prefixes in the bundle when dump is on", async () => {
    const js = await bundle(true);
    expect(js).toContain(ENGINE_DUMP_LOG_BEGIN);
  });
});
