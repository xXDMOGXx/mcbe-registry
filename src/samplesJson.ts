import fs from "node:fs";

/** Drops `//` to end-of-line (Mojang item/recipe JSONC). */
export function stripJsonLineComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "");
}

/** `JSON.parse`, then JSONC `//` retry if Mojang left comments (never strip valid `"///"` patterns). */
export function parseSamplesJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    try {
      return JSON.parse(stripJsonLineComments(raw)) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${filePath}: ${detail}`);
    }
  }
}
