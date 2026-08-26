"use server";

/**
 * The execution entry point the UI calls.
 *
 * Runs the full pipeline in one server round trip so no intermediate state can
 * be observed, cached or faked by the client:
 *
 *   validate -> preflight snapshot -> submit -> verify
 *
 * The returned object is the ONLY thing the terminal renders. It carries a
 * verification verdict derived from chain state, not the SDK's opinion, and
 * that verdict may be UNKNOWN.
 */

import { getMarketSnapshot, exchange } from "@/lib/venue/markets";
import { resolveVenueConfig } from "@/lib/venue/config";
import type { Outcome } from "@/lib/venue/types";
import {
  explorerTx,
  preflightSnapshot,
  submitOrder,
  validateOrder,
  verifyExecution,
  type OrderSide,
  type VerificationResult,
} from "@/lib/dreamdex/execution";

export interface ExecutionReport {
  phase: "VALIDATION_FAILED" | "SUBMITTED" | "NO_SIGNER";
  /** Present when validation rejected before anything was signed. */
  validation?: { reason: string; detail: string };
  verification?: VerificationResult;
  explorerUrl?: string | null;
  ref?: string;
  price?: number;
  amount?: number;
  estimatedCost?: number;
  /** Wall-clock ms for the whole pipeline. */
  elapsedMs: number;
}

export async function executeOrder(input: {
  marketId: string;
  outcome: Outcome;
  side: OrderSide;
  amount: number;
  price?: number;
}): Promise<ExecutionReport> {
  const started = Date.now();
  const config = resolveVenueConfig();

  const snap = await getMarketSnapshot(config);
  const market = snap.all.find((m) => m.marketId === input.marketId) ?? null;

  // Book is only needed to price a crossing order; a failure here is not fatal
  // because validation will reject with NO_BOOK_LIQUIDITY.
  let book: { bids: [number, number][]; asks: [number, number][] } | null = null;
  if (market) {
    try {
      const ob = await exchange(config).fetchOrderBook(`${market.symbol}#${input.outcome}`);
      book = {
        bids: (ob.bids ?? []) as [number, number][],
        asks: (ob.asks ?? []) as [number, number][],
      };
    } catch {
      book = null;
    }
  }

  const v = await validateOrder(
    { marketId: input.marketId, outcome: input.outcome, side: input.side, amount: input.amount, price: input.price },
    market,
    book,
    config,
  );

  if (!v.ok) {
    return {
      phase: v.reason === "NO_SIGNER" ? "NO_SIGNER" : "VALIDATION_FAILED",
      validation: { reason: v.reason, detail: v.detail },
      elapsedMs: Date.now() - started,
    };
  }

  // Snapshot BEFORE signing so balance and nonce deltas are attributable.
  const before = await preflightSnapshot(config);
  const submitted = await submitOrder(v, input.side, config);
  const verification = await verifyExecution(submitted, before, config);

  const hash =
    verification.status === "VERIFIED_EXECUTED"
      ? verification.transactionHash
      : verification.status === "VERIFIED_FAILED" || verification.status === "PENDING"
        ? verification.transactionHash
        : null;

  return {
    phase: "SUBMITTED",
    verification,
    // A link is produced only from a hash that survived verification.
    explorerUrl: hash ? explorerTx(hash, config) : null,
    ref: v.ref,
    price: v.price,
    amount: v.amount,
    estimatedCost: v.estimatedCost,
    elapsedMs: Date.now() - started,
  };
}
