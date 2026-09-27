import { describe, expect, it } from "vitest";
import { shouldClaimHost, stillOwnsHostClaim } from "./hostClaim.js";

describe("host claim", () => {
  it("lets the first claimant take an empty lock", () => {
    expect(shouldClaimHost(undefined, "dns")).toBe(true);
    expect(shouldClaimHost("", "dns")).toBe(true);
  });

  it("rejects a second claimant", () => {
    expect(shouldClaimHost("reciperegistry", "dns")).toBe(false);
  });

  it("lets the same claimant re-enter", () => {
    expect(shouldClaimHost("dns", "dns")).toBe(true);
  });

  it("confirms ownership only for the stored id", () => {
    expect(stillOwnsHostClaim("dns", "dns")).toBe(true);
    expect(stillOwnsHostClaim("reciperegistry", "dns")).toBe(false);
  });
});
