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

import { getMarketSnapshot, exchange } from "@sdk/venue/markets";
import { resolveVenueConfig } from "@sdk/venue/config";
import type { Outcome } from "@sdk/venue/types";
import { callerKey, checkRate, checkSpend } from "@sdk/dreamdex/guard";
import {
  explorerTx,
  preflightSnapshot,
  submitOrder,
  validateOrder,
  verifyExecution,
  type OrderSide,
  type VerificationResult,
} from "@sdk/dreamdex/execution";

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

  // Guards run BEFORE any venue read, so an abusive caller costs nothing
  // upstream either.
  const rate = checkRate(await callerKey());
  if (!rate.allowed) {
    return {
      phase: "VALIDATION_FAILED",
      validation: {
        reason: "RATE_LIMITED",
        detail: `Too many execution attempts. Try again in ${rate.retryAfterSec}s.`,
      },
      elapsedMs: Date.now() - started,
    };
  }

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

  // The shared demo wallet must stay solvent for the next visitor.
  const spend = await checkSpend(v.estimatedCost, config);
  if (!spend.allowed) {
    return {
      phase: "VALIDATION_FAILED",
      validation: { reason: "SPEND_LIMIT", detail: spend.reason ?? "Spend refused." },
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

/**
 * Build an order for the USER to sign.
 *
 * Returns unsigned calls; nothing is signed or sent here. This is the
 * non-custodial path — the one that removes the single-nonce ceiling, because
 * each user broadcasts from their own address.
 */
export async function prepareForWallet(input: {
  marketId: string;
  outcome: Outcome;
  amount: number;
}) {
  const config = resolveVenueConfig();
  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return {
      ok: false as const,
      reason: "RATE_LIMITED",
      detail: `Too many attempts. Retry in ${rate.retryAfterSec}s.`,
    };

  const snap = await getMarketSnapshot(config);
  const market = snap.all.find((m) => m.marketId === input.marketId) ?? null;

  // No spend guard here on purpose: the user is spending their OWN funds, so
  // the demo wallet's reserve is irrelevant to them.
  const { prepareOrder } = await import("@sdk/dreamdex/prepare");
  return prepareOrder(
    { marketId: input.marketId, outcome: input.outcome, side: "buy", amount: input.amount },
    market,
    config,
  );
}

/**
 * Mint or burn complete sets on the demo signer.
 *
 * Server-signed only: the SDK has no unsigned builder for sets, so a connected
 * user cannot route this through their own wallet yet. Guarded like every other
 * fund-moving action.
 */
export async function runSetAction(input: {
  marketId: string;
  amount: number;
  kind: "mint" | "burn";
}) {
  const config = resolveVenueConfig();
  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return {
      ok: false as const,
      status: "REJECTED" as const,
      txHash: null,
      blockNumber: null,
      collateralDelta: null,
      reason: `Too many attempts. Retry in ${rate.retryAfterSec}s.`,
      evidence: [],
    };

  // Minting escrows collateral, so it draws on the shared demo wallet.
  if (input.kind === "mint") {
    const spend = await checkSpend(input.amount, config);
    if (!spend.allowed)
      return {
        ok: false as const,
        status: "REJECTED" as const,
        txHash: null,
        blockNumber: null,
        collateralDelta: null,
        reason: spend.reason ?? "Spend refused.",
        evidence: [],
      };
  }

  const snap = await getMarketSnapshot(config);
  const market = snap.all.find((m) => m.marketId === input.marketId) ?? null;

  const { mintSet, burnSet } = await import("@sdk/dreamdex/sets");
  return input.kind === "mint"
    ? mintSet(market, input.amount, config)
    : burnSet(market, input.amount, config);
}
