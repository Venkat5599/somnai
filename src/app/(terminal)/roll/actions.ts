"use server";

import { executeRoll, planRoll, type RollPlan, type RollResult } from "@/lib/dreamdex/roll";
import type { Outcome } from "@/lib/venue/types";

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
  // Re-plans internally before signing: the successor may have been struck,
  // filled or moved between preview and commit.
  return executeRoll({ marketId, outcome, size });
}
