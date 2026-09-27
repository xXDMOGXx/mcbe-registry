import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { packageRecipeRegistryPack } from "./package-pack.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("packageRecipeRegistryPack", () => {
  it("zips dist/BP as BP/ inside recipe-registry.mcaddon", () => {
    const modDir = fs.mkdtempSync(path.join(os.tmpdir(), "rr-package-"));
    temps.push(modDir);
    const bpDir = path.join(modDir, "dist", "BP");
    fs.mkdirSync(path.join(bpDir, "texts"), { recursive: true });
    fs.writeFileSync(path.join(bpDir, "manifest.json"), '{"format_version":2}\n');
    const out = packageRecipeRegistryPack(modDir);
    expect(out).toBe(path.join(modDir, "dist", "recipe-registry.mcaddon"));
    expect(fs.existsSync(out)).toBe(true);
    const listed = spawnSync("python3", ["-c", "import sys, zipfile\nprint('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", out], {
      encoding: "utf8",
    });
    expect(listed.status).toBe(0);
    expect(listed.stdout.split("\n")).toContain("BP/manifest.json");
  });

  it("fails when dist/BP is missing", () => {
    const modDir = fs.mkdtempSync(path.join(os.tmpdir(), "rr-package-missing-"));
    temps.push(modDir);
    expect(() => packageRecipeRegistryPack(modDir)).toThrow(/Missing dist\/BP/);
  });
});
