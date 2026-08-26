"use server";

import { claim, findClaimable, type ClaimResult } from "@sdk/dreamdex/settlement";
import { resolveVenueConfig } from "@sdk/venue/config";

/**
 * Claim one settled holding.
 *
 * Re-scans before claiming rather than trusting an id the client sends back:
 * the row must still be claimable at the moment of the write, and the amount
 * must come from chain rather than from a form field.
 */
export async function claimOne(marketId: string, outcomeIdx: number): Promise<ClaimResult> {
  const rows = await findClaimable(50);
  const row = rows.find(
    (r) => r.marketId === marketId && r.outcomeIdx === outcomeIdx,
  );
  if (!row) {
    return {
      marketId,
      outcomeIdx,
      contracts: 0,
      txHash: null,
      status: "UNKNOWN",
      blockNumber: null,
      collateralDelta: null,
      evidence: ["holding is no longer claimable — it may already have been redeemed"],
    };
  }
  return claim(row, resolveVenueConfig());
}
