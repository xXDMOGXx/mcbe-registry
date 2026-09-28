import { describe, expect, it } from "vitest";
import packConfig from "../pack.config.js";
import {
  BP_DATA_UUID,
  BP_HEADER_UUID,
  BP_SCRIPT_UUID,
  PACK_LOCALE,
  packListLang,
  parsePackSemver,
  bedrockRegistryManifest,
} from "./packManifest.js";

describe("bedrockRegistryManifest", () => {
  it("keeps the shipping pack UUIDs from pack.config.ts", () => {
    expect(BP_HEADER_UUID).toBe(packConfig.manifest.bpHeader);
    expect(BP_DATA_UUID).toBe(packConfig.manifest.bpDataModule);
    expect(BP_SCRIPT_UUID).toBe(packConfig.manifest.bpScriptModule);
  });

  it("emits a script-only BP with stable Script API 2.8.0", () => {
    const manifest = bedrockRegistryManifest("1.0.0");
    expect(manifest).toMatchObject({
      format_version: 2,
      header: {
        uuid: BP_HEADER_UUID,
        version: [1, 0, 0],
        min_engine_version: [1, 21, 100],
      },
      dependencies: [{ module_name: "@minecraft/server", version: "2.8.0" }],
    });
    const modules = manifest.modules as { type: string; entry?: string }[];
    expect(modules.some((mod) => mod.type === "script" && mod.entry === "scripts/index.js")).toBe(true);
  });

  it("rejects a non-semver pack version", () => {
    expect(() => parsePackSemver("nightly")).toThrow(/Invalid pack version/);
  });

  it("substitutes the pack version into pack.description", () => {
    expect(packListLang("1.0.0")).toContain("v1.0.0 by xxdmogxx");
  });

  it("lists only en_US", () => {
    expect(PACK_LOCALE).toBe("en_US");
  });
});
