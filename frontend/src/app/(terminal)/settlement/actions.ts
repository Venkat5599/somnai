"use server";

/**
 * WHY EVERY ACTION IN THIS FILE CATCHES.
 *
 * A rejected server action does not surface as a handled error — Next renders
 * "Application error: a server-side exception has occurred" with an opaque
 * digest, and the user is left on a dead page with no idea whether their funds
 * moved. Reported in production against this deployment.
 *
 * These actions read the venue, and this testnet indexer times out regularly;
 * that is documented behaviour the read path already degrades around. The
 * actions did not. So a routine upstream hiccup during a click became a crash
 * screen, and on a WRITE path that is worse than a wrong answer: the user
 * cannot tell a refusal from a transaction that may have been broadcast.
 *
 * So every exported action returns a typed failure instead of throwing. The
 * shapes below never claim success on an error path.
 */

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
  const failed = (detail: string): ClaimResult => ({
    marketId,
    outcomeIdx,
    contracts: 0,
    txHash: null,
    // UNKNOWN, never a failure verdict: if the write itself threw, the
    // transaction may still have been broadcast and we must not say otherwise.
    status: "UNKNOWN",
    blockNumber: null,
    collateralDelta: null,
    evidence: [detail],
  });

  let rows;
  try {
    rows = await findClaimable(50);
  } catch (e) {
    return failed(
      `could not scan settled markets: ${
        e instanceof Error ? e.message.slice(0, 140) : "unknown error"
      }`,
    );
  }
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
  try {
    return await claim(row, resolveVenueConfig());
  } catch (e) {
    return failed(
      `claim threw: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}`,
    );
  }
}
