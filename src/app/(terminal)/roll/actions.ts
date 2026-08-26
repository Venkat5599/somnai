"use server";

import { executeRoll, planRoll, type RollPlan, type RollResult } from "@sdk/dreamdex/roll";
import type { Outcome } from "@sdk/venue/types";
import { callerKey, checkRate } from "@sdk/dreamdex/guard";

export async function previewRoll(
  marketId: string,
  outcome: Outcome,
  size: number,
): Promise<RollPlan> {
  return planRoll({ marketId, outcome, size });
}

export async function commitRoll(
  marketId: string,
  outcome: Outcome,
  size: number,
): Promise<RollResult> {
  const rate = checkRate(await callerKey());
  if (!rate.allowed) {
    return {
      planned: await planRoll({ marketId, outcome, size }),
      txHash: null,
      filled: 0,
      status: "NOT_ATTEMPTED",
      blockNumber: null,
      evidence: [`rate limited — retry in ${rate.retryAfterSec}s`],
    };
  }
  // Re-plans internally before signing: the successor may have been struck,
  // filled or moved between preview and commit.
  return executeRoll({ marketId, outcome, size });
}
