/** Behavior pack header UUID (world pack list / UUID dependencies). */
export const BP_HEADER_UUID = "33303c67-a05d-4964-b2c3-ba7c42d8d3b6";
/** Behavior pack data module UUID. */
export const BP_DATA_UUID = "c312ef9e-5151-47be-9795-610ae6b71443";
/** Behavior pack script module UUID. */
export const BP_SCRIPT_UUID = "fdf1ed07-264e-4296-b654-2cd02b2fa9a2";
/** Pack-list locale. Extra copies of English are not translations. */
export const PACK_LOCALE = "en_US";
/** `min_engine_version` for this script-only pack. */
export const MIN_ENGINE_VERSION = [1, 21, 100] as const;

/** `package.json` version as a three-int Bedrock array. */
export function parsePackSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Invalid pack version: "${version}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Pack-list `.lang` body (`{version}` already substituted). */
export function packListLang(version: string): string {
  return `pack.name=Recipe Registry\npack.description=Central registry that documents and relays all valid recipes. v${version} by xxdmogxx\n`;
}

/** BP `manifest.json` object for this host pack. */
export function recipeRegistryManifest(version: string): Record<string, unknown> {
  const semver = parsePackSemver(version);
  return {
    format_version: 2,
    header: {
      name: "pack.name",
      description: "pack.description",
      uuid: BP_HEADER_UUID,
      version: semver,
      min_engine_version: [...MIN_ENGINE_VERSION],
    },
    modules: [
      { type: "data", uuid: BP_DATA_UUID, version: semver },
      {
        type: "script",
        language: "javascript",
        uuid: BP_SCRIPT_UUID,
        version: semver,
        entry: "scripts/index.js",
      },
    ],
    dependencies: [{ module_name: "@minecraft/server", version: "2.8.0" }],
  };
}
