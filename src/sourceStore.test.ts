import { describe, expect, it } from "vitest";
import { canonicalizeRecipes } from "@mcbe-reciperegistry/client";
import {
  DP_CHUNK_LIMIT,
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
    writeSource(store, "demo", canonicalizeRecipes(a), a);
    writeSource(store, "other", canonicalizeRecipes([recipe("other:b")]), [recipe("other:b")]);
    writeSource(store, "demo", canonicalizeRecipes(cd), cd);
    expect(readSource(store, "demo")?.fp).toBe(canonicalizeRecipes(cd));
    expect(readSource(store, "demo")?.recipes.map((entry) => entry.id)).toEqual(["demo:c", "demo:d"]);
    expect(readSource(store, "other")?.recipes.map((entry) => entry.id)).toEqual(["other:b"]);
  });

  it("deletes leftover chunk indexes when a rewrite shrinks", () => {
    const store = memoryStore();
    const many = Array.from({ length: 40 }, (_, i) => recipe(`demo:r${i}`));
    writeSource(store, "demo", canonicalizeRecipes(many), many, 80);
    const before = store.getDynamicPropertyIds().filter((id) => id.startsWith("reciperegistry:src:demo:")).length;
    expect(before).toBeGreaterThan(2);
    const one = [recipe("demo:one")];
    writeSource(store, "demo", canonicalizeRecipes(one), one, 10000);
    expect(store.getDynamicPropertyIds().sort()).toEqual([sourceChunkKey("demo", 0), sourceMetaKey("demo")].sort());
    expect(readSource(store, "demo")?.recipes.map((entry) => entry.id)).toEqual(["demo:one"]);
  });

  it("deleteSource removes that prefix only", () => {
    const store = memoryStore();
    writeSource(store, "demo", "fp1", [recipe("demo:a")]);
    writeSource(store, "other", "fp2", [recipe("other:b")]);
    deleteSource(store, "demo");
    expect(listPersistedSources(store)).toEqual(["other"]);
    expect(loadAllSources(store).map((entry) => entry.source)).toEqual(["other"]);
  });

  it("writeSource of an empty list deletes the source", () => {
    const store = memoryStore();
    writeSource(store, "demo", "fp1", [recipe("demo:a")]);
    writeSource(store, "demo", "fp1", []);
    expect(readSource(store, "demo")).toBeUndefined();
    expect(listPersistedSources(store)).toEqual([]);
  });

  it("readSourceFingerprint returns meta fp without requiring chunk parse", () => {
    const store = memoryStore();
    writeSource(store, "demo", "fp1", [recipe("demo:a")]);
    expect(readSourceFingerprint(store, "demo")).toBe("fp1");
    expect(readSourceFingerprint(store, "missing")).toBeUndefined();
  });

  it("splitBlob respects the default DP budget", () => {
    expect(splitBlob("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(DP_CHUNK_LIMIT).toBe(24000);
  });

  it("derives fingerprint when loading legacy rev meta", () => {
    const store = memoryStore();
    const recipes = [recipe("demo:a")];
    store.setDynamicProperty(sourceChunkKey("demo", 0), JSON.stringify(recipes));
    store.setDynamicProperty(sourceMetaKey("demo"), JSON.stringify({ v: 1, rev: 1000, chunks: 1 }));
    const loaded = readSource(store, "demo");
    expect(loaded?.fp).toBe(canonicalizeRecipes(recipes));
    expect(loaded?.recipes.map((r) => r.id)).toEqual(["demo:a"]);
  });
});
