import { system, world } from "@minecraft/server";
import { HOST_CLAIM_PROPERTY, shouldClaimHost, stillOwnsHostClaim } from "../src/hostClaim.js";
import { startRecipeRegistryHost } from "./host.js";

const CLAIMANT = "reciperegistry";

system.run(() => {
  const existing = world.getDynamicProperty(HOST_CLAIM_PROPERTY) as string | undefined;
  if (!shouldClaimHost(existing, CLAIMANT)) return;
  world.setDynamicProperty(HOST_CLAIM_PROPERTY, CLAIMANT);
  system.run(() => {
    const stored = world.getDynamicProperty(HOST_CLAIM_PROPERTY) as string | undefined;
    if (!stillOwnsHostClaim(stored, CLAIMANT)) return;
    startRecipeRegistryHost();
  });
});
