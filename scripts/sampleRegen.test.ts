import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catalogMinecraftFromSource, sampleRegen, snapshotNeedsRegen } from "./sampleRegen.js";
import { parseSamplesJson, stripJsonLineComments } from "./regen-vanilla-catalog.js";

describe("catalogMinecraftFromSource", () => {
  it("reads VANILLA_CATALOG_MINECRAFT from vanillaCatalog.ts source", () => {
    expect(
      catalogMinecraftFromSource(
        `export const VANILLA_CATALOG_MINECRAFT = "1.26.40.5";\nexport const VANILLA_RECIPES = [];\n`,
      ),
    ).toBe("1.26.40.5");
  });

  it("throws when the constant is missing", () => {
    expect(() => catalogMinecraftFromSource("export const VANILLA_RECIPES = [];\n")).toThrow(
      /VANILLA_CATALOG_MINECRAFT missing/,
    );
  });
});

describe("snapshotNeedsRegen", () => {
  it("is false when samples and catalog labels match", () => {
    expect(snapshotNeedsRegen("1.26.40.5", "1.26.40.5")).toBe(false);
  });

  it("is true when samples are a newer label", () => {
    expect(snapshotNeedsRegen("1.27.0.0", "1.26.40.5")).toBe(true);
  });
});

describe("sampleRegen", () => {
  it("skips the projector when samples version matches the catalog file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbab-sample-regen-"));
    const catalogPath = path.join(dir, "vanillaCatalog.ts");
    fs.writeFileSync(catalogPath, `export const VANILLA_CATALOG_MINECRAFT = "1.26.40.5";\n`);
    const samples = path.join(dir, "samples");
    fs.mkdirSync(samples);
    fs.writeFileSync(path.join(samples, "version.json"), JSON.stringify({ latest: { version: "1.26.40.5" } }));
    await expect(sampleRegen({ catalogPath, sync: () => samples })).resolves.toBe("skipped");
  });
});

describe("stripJsonLineComments", () => {
  it("parses Mojang item JSONC with // after a duration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbab-jsonc-"));
    const filePath = path.join(dir, "apple.json");
    fs.writeFileSync(
      filePath,
      `{
  "duration": 120, // 2 * 60
  "name": "absorption"
}
`,
    );
    expect(JSON.parse(stripJsonLineComments(fs.readFileSync(filePath, "utf8")))).toEqual({
      duration: 120,
      name: "absorption",
    });
    expect(parseSamplesJson(filePath)).toEqual({ duration: 120, name: "absorption" });
  });

  it("keeps shaped pattern rows that are only slashes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbab-jsonc-"));
    const filePath = path.join(dir, "armor_stand.json");
    fs.writeFileSync(
      filePath,
      `{
  "pattern": [
    "///",
    " / ",
    "/_/"
  ]
}
`,
    );
    expect(parseSamplesJson(filePath)).toEqual({ pattern: ["///", " / ", "/_/"] });
  });
});
