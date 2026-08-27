/**
 * Batch shapes and the grading function — deliberately NOT server-only.
 *
 * Same reasoning as grid.ts: this is pure logic with no SDK, no network and no
 * key, and it is the part that most needs testing. `server-only` throws the
 * moment vitest imports it, so leaving `decideAtomicity` inside batch.ts meant
 * the one function in the whole module that can LIE was the one function that
 * could not be tested.
 *
 * Everything else in batch.ts reports a fact — a receipt status, a fill size, a
 * blocker. This file takes those facts and puts a name on the guarantee that was
 * actually delivered, and that name is what the user reads and acts on. Calling
 * an exposed position "unwound" would be worse than any bug in the execution
 * path, because it turns a known problem into an unknown one.
 */

import type { Outcome } from "@sdk/venue/types";

export interface BatchLeg {
  marketId: string;
  outcome: Outcome;
  side: "buy" | "sell";
  /** Contracts. */
  size: number;
  /** Probability in (0,1). Omitted crosses the book. */
  price?: number;
  /** Shown to the user so a rejected batch names the leg in their terms. */
  label?: string;
}

export type LegBlocker =
  | "MARKET_NOT_FOUND"
  | "MARKET_UNSTRUCK"
  | "MARKET_NOT_TRADING"
  | "MARKET_EXPIRED"
  | "WITHIN_EXPIRY_HEADROOM"
  | "NO_BOOK_LIQUIDITY"
  | "SIZE_BELOW_MINIMUM";

export interface LegPlan {
  leg: BatchLeg;
  ok: boolean;
  blocker?: LegBlocker;
  detail?: string;
  /** Price the leg would cross at, from the live book. */
  price: number | null;
  cost: number | null;
  symbol: string | null;
}

export interface LegOutcome {
  leg: BatchLeg;
  status: "FILLED" | "KILLED" | "FAILED" | "NOT_ATTEMPTED";
  txHash: string | null;
  blockNumber: number | null;
  filled: number;
  evidence: string[];
}

export interface UnwindOutcome {
  leg: BatchLeg;
  status: "UNWOUND" | "UNWIND_FAILED";
  txHash: string | null;
  size: number;
  detail: string | null;
}

/**
 * The honest name for the guarantee actually delivered. Never "ATOMIC" here.
 *
 *   PREFLIGHT_ALL_OR_NOTHING — nothing was signed; the batch was refused whole
 *   SEQUENTIAL_VERIFIED      — every leg filled, each verified from chain
 *   PARTIAL_UNWOUND          — a leg failed; the filled legs were sold back
 *   PARTIAL_EXPOSED          — a leg failed AND an unwind failed. Read this one.
 */
export type Atomicity =
  | "PREFLIGHT_ALL_OR_NOTHING"
  | "SEQUENTIAL_VERIFIED"
  | "PARTIAL_UNWOUND"
  | "PARTIAL_EXPOSED";

/**
 * Decide which guarantee was actually delivered.
 *
 * Split out of executeBatch and made pure so it can be tested directly. This is
 * the one function in the file that can lie: every other part reports facts, and
 * this part grades them. An overclaim here — calling a partial fill "verified",
 * or an exposed position "unwound" — is exactly the failure the whole module
 * exists to prevent, and it is invisible without live legs to run against.
 */
export function decideAtomicity(
  outcomes: Pick<LegOutcome, "status" | "filled">[],
  unwinds: Pick<UnwindOutcome, "status">[],
): Atomicity {
  // Nothing was sent at all.
  if (outcomes.every((o) => o.status === "NOT_ATTEMPTED")) return "PREFLIGHT_ALL_OR_NOTHING";

  // Every leg filled. This is the only success case, and it requires ALL of
  // them — a KILLED leg means the structure is incomplete, not that it worked.
  if (outcomes.every((o) => o.status === "FILLED")) return "SEQUENTIAL_VERIFIED";

  // Something went wrong. If nothing had filled there is nothing exposed; if
  // anything filled, the unwinds decide whether we are flat or still holding.
  const filled = outcomes.filter((o) => o.status === "FILLED" && o.filled > 0);
  if (filled.length === 0) return "PREFLIGHT_ALL_OR_NOTHING";

  // An unwind that was never attempted cannot count as a successful unwind.
  if (unwinds.length < filled.length) return "PARTIAL_EXPOSED";

  return unwinds.every((u) => u.status === "UNWOUND") ? "PARTIAL_UNWOUND" : "PARTIAL_EXPOSED";
}

export interface BatchResult {
  atomicity: Atomicity;
  plans: LegPlan[];
  outcomes: LegOutcome[];
  unwinds: UnwindOutcome[];
  /** What the chain says about EIP-7702 right now, carried for the UI. */
  eip7702Available: boolean;
  totalCost: number | null;
  elapsedMs: number;
}
