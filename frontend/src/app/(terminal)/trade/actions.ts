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
import { headroomSec, type Outcome } from "@sdk/venue/types";
import { callerKey, checkRate, checkSpend } from "@sdk/dreamdex/guard";
import {
  explorerTx,
  preflightSnapshot,
  submitOrder,
  validateOrder,
  verifyExecution,
  MAX_ORDER_CONTRACTS,
  type OrderSide,
  type VerificationResult,
} from "@sdk/dreamdex/execution";
import { placeLimit } from "@sdk/dreamdex/place-limit";

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

export interface RestReport {
  ok: boolean;
  reason?: string;
  detail?: string;
  hash?: string | null;
  orderId?: string | null;
  explorerUrl?: string | null;
  price?: number;
  size?: number;
  /** False when the order crossed and filled instead of resting. */
  rested?: boolean;
  filled?: number;
  elapsedMs: number;
}

/**
 * REST A BID — the answer to an empty book.
 *
 * Every other write in PRISM crosses a resting offer, so all of them require
 * somebody else to be quoting first. When nobody is, the terminal could only
 * tell the reader to wait: the product had exactly one verb and the venue had
 * taken it away.
 *
 * A post-only order is the other side of that trade. It ADDS liquidity rather
 * than taking it, so it needs no counterparty to exist yet — the user becomes
 * the book. It rests until someone lifts it or the window closes, and the venue
 * cancels it at expiry, so nothing is left locked past the window it belongs
 * to.
 *
 * PROVEN ON CHAIN before this was wired to a control, not after:
 *   place  0x2bc57a675bdea676be1f57d889e3e3b11d708e424de04ecc136c02879292df8b
 *          orderId 73786976294838713577, filled 0, rested true
 *   cancel 0x945a0901c420b8171668040435d2ba249656fffb8c4515d669881303814a69ba
 *          block 478935387, VERIFIED_CANCELLED, stillResting []
 *
 * The first attempt REVERTED with OrderAlreadyExpired(), which is a verdict
 * about the MARKET rather than the order — see the headroom guard below.
 */
export async function restBid(input: {
  marketId: string;
  outcome: Outcome;
  price: number;
  size: number;
}): Promise<RestReport> {
  const started = Date.now();
  const config = resolveVenueConfig();

  const rate = checkRate(await callerKey());
  if (!rate.allowed)
    return {
      ok: false,
      reason: "RATE_LIMITED",
      detail: `Too many attempts. Try again in ${rate.retryAfterSec}s.`,
      elapsedMs: Date.now() - started,
    };

  if (!(input.price > 0 && input.price < 1))
    return {
      ok: false,
      reason: "PRICE_OUT_OF_RANGE",
      detail: "A probability has to sit strictly between 0 and 1.",
      elapsedMs: Date.now() - started,
    };

  if (!(input.size > 0) || input.size > MAX_ORDER_CONTRACTS)
    return {
      ok: false,
      reason: "AMOUNT_ABOVE_LIMIT",
      detail: `The demo signer rests at most ${MAX_ORDER_CONTRACTS} contracts.`,
      elapsedMs: Date.now() - started,
    };

  let market;
  try {
    const snap = await getMarketSnapshot(config);
    market = snap.all.find((m) => m.marketId === input.marketId) ?? null;
  } catch (e) {
    return {
      ok: false,
      reason: "VENUE_UNREADABLE",
      detail: `The registry could not be read, so nothing was signed: ${
        e instanceof Error ? e.message.slice(0, 140) : "unknown error"
      }`,
      elapsedMs: Date.now() - started,
    };
  }

  if (!market)
    return {
      ok: false,
      reason: "MARKET_NOT_FOUND",
      detail: "That window is no longer in the registry.",
      elapsedMs: Date.now() - started,
    };

  // THE HEADROOM IS NOT OPTIONAL HERE. The first on-chain attempt reverted with
  // OrderAlreadyExpired() on a window that still looked open when the order was
  // built: the venue rejects a resting order aimed into a close, because it
  // would be cancelled on arrival. Refusing costs nothing; the revert cost gas.
  const left = market.expiry - Math.floor(Date.now() / 1000);
  const need = Math.max(headroomSec(market.intervalSec), 60);
  if (left < need)
    return {
      ok: false,
      reason: "TOO_CLOSE_TO_EXPIRY",
      detail: `This window closes in ${left}s. A resting order needs at least ${need}s of life or the venue rejects it as already expired.`,
      elapsedMs: Date.now() - started,
    };

  // Collateral leaves the wallet as escrow the moment the order rests, so the
  // funding check is the same one the taker path runs — a resting order that
  // cannot be funded reverts exactly like a crossing one.
  const spend = await checkSpend(input.price * input.size, config);
  if (!spend.allowed)
    return {
      ok: false,
      reason: "SPEND_REFUSED",
      detail: spend.reason ?? "The demo signer's spend guard refused this order.",
      elapsedMs: Date.now() - started,
    };

  try {
    const res = await placeLimit(
      {
        marketId: input.marketId,
        outcome: input.outcome,
        side: "buy",
        price: input.price,
        size: input.size,
        type: "post-only",
        // Never outlive the window it belongs to; placeLimit caps this at the
        // market's own expiry anyway.
        expiresInSec: Math.max(30, left - 5),
      },
      config,
    );

    return {
      ok: Boolean(res.hash),
      hash: res.hash,
      orderId: res.orderId,
      explorerUrl: res.hash ? explorerTx(res.hash, config) : null,
      price: res.price,
      size: res.size,
      rested: res.rested,
      filled: res.filled,
      reason: res.hash ? undefined : "NOT_PLACED",
      detail: res.hash
        ? undefined
        : "The order did not reach the chain — nothing was signed.",
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    // A revert here is a real venue answer, not a crash. Surfaced verbatim so a
    // reader can look it up rather than meeting a generic failure.
    return {
      ok: false,
      reason: "REVERTED",
      detail: e instanceof Error ? e.message.slice(0, 200) : "unknown error",
      elapsedMs: Date.now() - started,
    };
  }
}
