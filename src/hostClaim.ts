/**
 * World DP used so at most one Recipe Registry host runs when several packs
 * ship host code (Marketplace DNS + standalone Recipe Registry).
 */
export const HOST_CLAIM_PROPERTY = "reciperegistry:host_claim";

/**
 * Whether `claimantId` should start the host given the current DP value.
 * Empty/absent means this claimant may write the claim.
 */
export function shouldClaimHost(existing: string | undefined | null, claimantId: string): boolean {
  return existing === undefined || existing === null || existing === "" || existing === claimantId;
}

/**
 * After a write, the stored value must still be this claimant or this isolate lost the race.
 */
export function stillOwnsHostClaim(stored: string | undefined | null, claimantId: string): boolean {
  return stored === claimantId;
}
