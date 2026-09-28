import { describe, expect, it } from "vitest";
import { canonicalizeRecipes, DEFAULT_REGISTRY_KIND } from "@mcbe-registry/client";
import {
  DP_CHUNK_LIMIT,
  LEGACY_SOURCE_KEY_PREFIX,
  SOURCE_KEY_PREFIX,
  deleteSource,
  isValidSource,
  listPersistedSources,
  loadAllSources,
  readSource,
  readSourceFingerprint,
  sourceChunkKey,
  sourceMetaKey,
  splitBlob,
  writeSource,
  type DynamicPropertyStore,
} from "./sourceStore.js";
import type { Recipe } from "./protocol.js";

function memoryStore(): DynamicPropertyStore {
  const properties = new Map<string, string | number | boolean>();
  return {
    getDynamicProperty(id) {
      return properties.get(id);
    },
    setDynamicProperty(id, value) {
      if (value === undefined) properties.delete(id);
      else properties.set(id, value);
    },
    getDynamicPropertyIds() {
      return [...properties.keys()];
    },
  };
}

const recipe = (id: string): Recipe => ({
  id,
  stations: ["mymod:crusher"],
  inputs: ["minecraft:cobblestone"],
  outputs: ["minecraft:gravel"],
});

const KIND = DEFAULT_REGISTRY_KIND;

describe("sourceStore", () => {
  it("accepts namespace-like sources and rejects punctuation", () => {
    expect(isValidSource("demo")).toBe(true);
    expect(isValidSource("digitalstorage")).toBe(true);
    expect(isValidSource("Demo")).toBe(false);
    expect(isValidSource("a:b")).toBe(false);
  });

  it("replaces one source's blobs without touching another", () => {
    const store = memoryStore();
    const a = [recipe("demo:a")];
    const cd = [recipe("demo:c"), recipe("demo:d")];
    writeSource(store, "demo", KIND, canonicalizeRecipes(a), a);
    writeSource(store, "other", KIND, canonicalizeRecipes([recipe("other:b")]), [recipe("other:b")]);
    writeSource(store, "demo", KIND, canonicalizeRecipes(cd), cd);
    expect(readSource(store, "demo")?.fp).toBe(canonicalizeRecipes(cd));
    expect(readSource(store, "demo")?.documents.map((entry) => (entry as Recipe).id)).toEqual(["demo:c", "demo:d"]);
    expect(readSource(store, "other")?.documents.map((entry) => (entry as Recipe).id)).toEqual(["other:b"]);
  });

  it("writes independent fingerprints per kind under the same source", () => {
    const store = memoryStore();
    const recipes = [recipe("demo:a")];
    const items = [{ id: "demo:widget", extra: { n: 1 } }];
    writeSource(store, "demo", "recipe", "fp-recipe", recipes);
    writeSource(store, "demo", "item", "fp-item", items);
    expect(readSourceFingerprint(store, "demo", "recipe")).toBe("fp-recipe");
    expect(readSourceFingerprint(store, "demo", "item")).toBe("fp-item");
    writeSource(store, "demo", "item", "fp-item-2", [{ id: "demo:widget", extra: { n: 2 } }]);
    expect(readSourceFingerprint(store, "demo", "recipe")).toBe("fp-recipe");
    expect(readSource(store, "demo", "recipe")?.documents.map((entry) => (entry as Recipe).id)).toEqual(["demo:a"]);
    expect(readSource(store, "demo", "item")?.fp).toBe("fp-item-2");
  });

  it("deletes leftover chunk indexes when a rewrite shrinks", () => {
    const store = memoryStore();
    const many = Array.from({ length: 40 }, (_, i) => recipe(`demo:r${i}`));
    writeSource(store, "demo", KIND, canonicalizeRecipes(many), many, 80);
    const before = store.getDynamicPropertyIds().filter((id) => id.startsWith(`${SOURCE_KEY_PREFIX}demo:`)).length;
    expect(before).toBeGreaterThan(2);
    const one = [recipe("demo:one")];
    writeSource(store, "demo", KIND, canonicalizeRecipes(one), one, 10000);
    expect(store.getDynamicPropertyIds().sort()).toEqual(
      [sourceChunkKey("demo", KIND, 0), sourceMetaKey("demo", KIND)].sort(),
    );
    expect(readSource(store, "demo")?.documents.map((entry) => (entry as Recipe).id)).toEqual(["demo:one"]);
  });

  it("deleteSource removes that prefix only", () => {
    const store = memoryStore();
    writeSource(store, "demo", KIND, "fp1", [recipe("demo:a")]);
    writeSource(store, "other", KIND, "fp2", [recipe("other:b")]);
    deleteSource(store, "demo");
    expect(listPersistedSources(store)).toEqual(["other"]);
    expect(loadAllSources(store).map((entry) => entry.source)).toEqual(["other"]);
  });

  it("writeSource of an empty list deletes the source kind", () => {
    const store = memoryStore();
    writeSource(store, "demo", KIND, "fp1", [recipe("demo:a")]);
    writeSource(store, "demo", KIND, "fp1", []);
    expect(readSource(store, "demo")).toBeUndefined();
    expect(listPersistedSources(store)).toEqual([]);
  });

  it("readSourceFingerprint returns meta fp without requiring chunk parse", () => {
    const store = memoryStore();
    writeSource(store, "demo", KIND, "fp1", [recipe("demo:a")]);
    expect(readSourceFingerprint(store, "demo")).toBe("fp1");
    expect(readSourceFingerprint(store, "missing")).toBeUndefined();
  });

  it("splitBlob respects the default DP budget", () => {
    expect(splitBlob("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(DP_CHUNK_LIMIT).toBe(24000);
  });

  it("ignores leftover reciperegistry persist keys", () => {
    const store = memoryStore();
    const recipes = [recipe("demo:a")];
    store.setDynamicProperty(`${LEGACY_SOURCE_KEY_PREFIX}demo:0`, JSON.stringify(recipes));
    store.setDynamicProperty(`${LEGACY_SOURCE_KEY_PREFIX}demo:meta`, JSON.stringify({ v: 2, fp: "old", chunks: 1 }));
    expect(listPersistedSources(store)).toEqual([]);
    expect(readSource(store, "demo")).toBeUndefined();
    expect(SOURCE_KEY_PREFIX).toBe("bedrockregistry:src:");
  });
});
