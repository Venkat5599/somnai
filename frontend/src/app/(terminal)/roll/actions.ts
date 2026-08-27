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

import { executeRoll, planRoll, type RollPlan, type RollResult } from "@sdk/dreamdex/roll";
import type { Outcome } from "@sdk/venue/types";
import { callerKey, checkRate } from "@sdk/dreamdex/guard";

export async function previewRoll(
  marketId: string,
  outcome: Outcome,
  size: number,
): Promise<RollPlan> {
  try {
    return await planRoll({ marketId, outcome, size });
  } catch (e) {
    // A plan that cannot be computed is a blocked plan, not a crash.
    return {
      ok: false,
      blocker: "MARKET_NOT_FOUND",
      detail: `The venue could not be read: ${
        e instanceof Error ? e.message.slice(0, 140) : "unknown error"
      }`,
      from: null,
      to: null,
      outcome,
      size,
      price: null,
      estimatedCost: null,
      secondsLeft: 0,
      headroom: 0,
    };
  }
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
  try {
    return await executeRoll({ marketId, outcome, size });
  } catch (e) {
    // NOT_ATTEMPTED is the honest status here: executeRoll only throws before
    // it reaches placeLimit, since the leg itself is already wrapped. Claiming
    // anything stronger would assert something about a transaction that may
    // not exist.
    return {
      planned: await previewRoll(marketId, outcome, size),
      txHash: null,
      filled: 0,
      status: "NOT_ATTEMPTED",
      blockNumber: null,
      evidence: [
        `roll failed before signing: ${
          e instanceof Error ? e.message.slice(0, 160) : "unknown error"
        }`,
      ],
    };
  }
}
