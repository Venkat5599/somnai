"use server";

/**
 * The multi-leg entry point.
 *
 * `sdk/dreamdex/batch.ts` was written and then imported by nobody — a library
 * with no caller, while the README claimed "the UI prints it". That is the same
 * unchecked-claim failure the module was written to fix, so this file and the
 * panel beside it exist to make the claim true.
 *
 * Guards match the single-leg path exactly. A batch is not a special case: it
 * is N fund-moving writes on the same shared demo wallet, so if anything it
 * needs the spend floor more than one order does. The estimated cost passed to
 * `checkSpend` is the WHOLE basket, not a leg, because approving each leg
 * separately would let a five-leg batch walk the wallet down past the reserve
 * one allowed step at a time.
 */

import { resolveVenueConfig } from "@sdk/venue/config";
import { callerKey, checkRate, checkSpend } from "@sdk/dreamdex/guard";
import { executeBatch, planBatch } from "@sdk/dreamdex/batch";
import type { BatchLeg, BatchResult, LegPlan } from "@sdk/dreamdex/atomicity";

/** Hard ceiling on legs. A basket the venue cannot fill fast is a basket that unwinds. */
const MAX_LEGS = 4;

export interface BasketPlan {
  ok: boolean;
  plans: LegPlan[];
  totalCost: number | null;
  reason?: string;
}

/** Price and gate a basket. Nothing is signed here, so a doomed plan is free. */
export async function planBasket(legs: BatchLeg[]): Promise<BasketPlan> {
  const config = resolveVenueConfig();

  if (!legs.length) return { ok: false, plans: [], totalCost: null, reason: "No legs selected." };
  if (legs.length > MAX_LEGS)
    return {
      ok: false,
      plans: [],
      totalCost: null,
      reason: `This deployment caps a basket at ${MAX_LEGS} legs.`,
    };

  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return {
      ok: false,
      plans: [],
      totalCost: null,
      reason: `Too many attempts. Retry in ${rate.retryAfterSec}s.`,
    };

  const plans = await planBatch(legs, config);
  const ok = plans.every((p) => p.ok);

  return {
    ok,
    plans,
    // A total is only meaningful when every leg priced; a partial sum would
    // understate what the basket costs and it is the number a user commits on.
    totalCost: ok ? plans.reduce((n, p) => n + (p.cost ?? 0), 0) : null,
    reason: ok ? undefined : "At least one leg cannot be routed, so nothing will be sent.",
  };
}

export interface BasketRun {
  ok: boolean;
  result: BatchResult | null;
  reason?: string;
}

/**
 * Open the basket.
 *
 * Returns the raw `BatchResult` so the panel can print the guarantee that was
 * actually delivered rather than a boolean the server decided on its behalf.
 */
export async function executeBasket(legs: BatchLeg[]): Promise<BasketRun> {
  const config = resolveVenueConfig();

  if (!legs.length) return { ok: false, result: null, reason: "No legs selected." };
  if (legs.length > MAX_LEGS)
    return { ok: false, result: null, reason: `This deployment caps a basket at ${MAX_LEGS} legs.` };

  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return { ok: false, result: null, reason: `Too many attempts. Retry in ${rate.retryAfterSec}s.` };

  // Price first so the spend guard sees the real number. Re-planning inside
  // executeBatch is deliberate and cheap: the book can move between the two
  // reads, and the plan that matters is the one taken immediately before the
  // first signature.
  const plans = await planBatch(legs, config);
  if (!plans.every((p) => p.ok))
    return {
      ok: false,
      result: null,
      reason: "At least one leg stopped being routable. Nothing was sent.",
    };

  const estimated = plans.reduce((n, p) => n + (p.cost ?? 0), 0);
  const spend = await checkSpend(estimated, config);
  if (!spend.allowed)
    return { ok: false, result: null, reason: spend.reason ?? "Spend refused." };

  const result = await executeBatch(legs, config);
  return { ok: result.atomicity === "SEQUENTIAL_VERIFIED", result };
}
