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

  let snap;
  try {
    snap = await getMarketSnapshot(config);
  } catch (e) {
    // Never let this reject: a rejected action renders Next's opaque digest
    // screen, and on a signing path the user cannot tell a refusal from a
    // transaction that may have been broadcast.
    return {
      phase: "VALIDATION_FAILED",
      validation: {
        reason: "VENUE_UNREADABLE",
        detail: `The registry could not be read, so nothing was signed: ${
          e instanceof Error ? e.message.slice(0, 140) : "unknown error"
        }`,
      },
      elapsedMs: Date.now() - started,
    };
  }
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
  //
  // From here on a throw is genuinely dangerous: the order may have reached the
  // chain. submitOrder never throws by design, but preflight and verification
  // read the chain and can. The answer is UNKNOWN — never a failure verdict,
  // because "it failed" would be a claim we cannot support.
  let verification: VerificationResult;
  try {
    const before = await preflightSnapshot(config);
    const submitted = await submitOrder(v, input.side, config);
    verification = await verifyExecution(submitted, before, config);
  } catch (e) {
    verification = {
      status: "UNKNOWN",
      reason:
        "The chain could not be read while submitting, so the outcome cannot be attributed. Check the wallet on the explorer before retrying.",
      evidence: [e instanceof Error ? e.message.slice(0, 160) : "unknown error"],
    };
  }

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
  /** The connected wallet. The builder tier is bound to it; see prepare.ts. */
  owner: string;
}) {
  const config = resolveVenueConfig();
  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return {
      ok: false as const,
      reason: "RATE_LIMITED",
      detail: `Too many attempts. Retry in ${rate.retryAfterSec}s.`,
    };

  // No spend guard here on purpose: the user is spending their OWN funds, so
  // the demo wallet's reserve is irrelevant to them. But the registry read can
  // still fail, and an unsigned-order builder that REJECTS strands the user on
  // the digest crash screen instead of telling them to retry.
  try {
    const snap = await getMarketSnapshot(config);
    const market = snap.all.find((m) => m.marketId === input.marketId) ?? null;
    const { prepareOrder } = await import("@sdk/dreamdex/prepare");
    return await prepareOrder(
      {
        marketId: input.marketId,
        outcome: input.outcome,
        side: "buy",
        amount: input.amount,
        owner: input.owner,
      },
      market,
      config,
    );
  } catch (e) {
    return {
      ok: false as const,
      reason: "VENUE_UNREADABLE",
      detail: `Nothing was built to sign: ${
        e instanceof Error ? e.message.slice(0, 140) : "unknown error"
      }`,
    };
  }
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

  try {
    const snap = await getMarketSnapshot(config);
    const market = snap.all.find((m) => m.marketId === input.marketId) ?? null;

    const { mintSet, burnSet } = await import("@sdk/dreamdex/sets");
    return await (input.kind === "mint"
      ? mintSet(market, input.amount, config)
      : burnSet(market, input.amount, config));
  } catch (e) {
    // UNKNOWN, not REJECTED: mint and burn move funds, and a throw after the
    // write was sent must not be reported as "nothing happened".
    return {
      ok: false as const,
      status: "UNKNOWN" as const,
      txHash: null,
      blockNumber: null,
      collateralDelta: null,
      reason: `The set operation could not be completed or confirmed: ${
        e instanceof Error ? e.message.slice(0, 160) : "unknown error"
      }`,
      evidence: [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Making, for when there is nothing to take                           */
/* ------------------------------------------------------------------ */

/**
 * REST A BID — the answer to an empty book, signed by the USER.
 *
 * Every other write in PRISM crosses a resting offer, so all of them require
 * somebody else to be quoting first. When nobody is, the terminal could only
 * say "wait": the product had one verb and the venue had taken it away. A
 * post-only order is the other side of that trade — it ADDS the offer instead
 * of taking one, so it needs no counterparty to exist yet.
 *
 * THIS RETURNS AN UNSIGNED CALL. The first version of this action signed with
 * the server burner, which would have let any visitor spend the operator's
 * collateral by clicking a button — precisely the "loaded gun" the execute
 * panel says it removed when the server-signed buy path was deleted. A maker
 * order is not a lesser thing than a taker order and does not get a lesser
 * custody model: the user signs, from their own address, or nothing happens.
 *
 * The path is proven on chain, at the same order type, before it was wired to
 * any control:
 *   place  0x2bc57a675bdea676be1f57d889e3e3b11d708e424de04ecc136c02879292df8b
 *          orderId 73786976294838713577, filled 0, rested true
 *   cancel 0x945a0901c420b8171668040435d2ba249656fffb8c4515d669881303814a69ba
 *          block 478935387, VERIFIED_CANCELLED, stillResting []
 */
export async function prepareRestForWallet(input: {
  marketId: string;
  outcome: Outcome;
  price: number;
  amount: number;
  /** The connected wallet. The builder tier is bound to it; see prepare.ts. */
  owner: string;
}) {
  const config = resolveVenueConfig();
  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return {
      ok: false as const,
      reason: "RATE_LIMITED",
      detail: `Too many attempts. Retry in ${rate.retryAfterSec}s.`,
    };

  if (!(input.price > 0 && input.price < 1))
    return {
      ok: false as const,
      reason: "PRICE_OUT_OF_RANGE",
      detail: "A probability has to sit strictly between 0 and 1.",
    };

  // No spend guard: the user is escrowing their OWN collateral, so the demo
  // wallet's reserve is irrelevant to them.
  try {
    const snap = await getMarketSnapshot(config);
    const market = snap.all.find((m) => m.marketId === input.marketId) ?? null;
    const { prepareOrder } = await import("@sdk/dreamdex/prepare");
    return await prepareOrder(
      {
        marketId: input.marketId,
        outcome: input.outcome,
        side: "buy",
        amount: input.amount,
        price: input.price,
        type: "post-only",
        owner: input.owner,
      },
      market,
      config,
    );
  } catch (e) {
    return {
      ok: false as const,
      reason: "VENUE_UNREADABLE",
      detail: `The registry could not be read, so nothing was built to sign: ${
        e instanceof Error ? e.message.slice(0, 140) : "unknown error"
      }`,
    };
  }
}
