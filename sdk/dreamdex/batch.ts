import "server-only";

/**
 * Multi-leg execution — the thing EIP-7702 was supposed to provide.
 *
 * WHAT WAS CLAIMED, AND WHY IT WAS WRONG. Three screens and two docs said
 * atomic multi-leg batching was coming via EIP-7702. It is not coming: EIP-7702
 * ships in Prague, and Somnia Shannon carries none of Prague's system contracts
 * (see venue/capabilities.ts, which now probes this rather than asserting it).
 * "Planned" was doing work that "unavailable on this chain" should have done.
 *
 * SO WHAT IS ACTUALLY ACHIEVABLE. The goal behind batching was never the
 * transaction type — it was the guarantee: a structure opens whole, or it does
 * not open at all. Without 7702 that guarantee splits into two halves, and one
 * of them is fully recoverable:
 *
 *   1. REJECT BEFORE SIGNING. Every leg is validated against the live registry
 *      and its own book BEFORE the first signature exists. If any leg is
 *      unroutable, nothing is sent at all. This covers the overwhelming
 *      majority of real failures — unstruck successor, closed window, thin
 *      book, size below the venue minimum — and for that class the batch
 *      genuinely IS all-or-nothing.
 *
 *   2. UNWIND WHAT FILLED. A leg can still fail after an earlier one filled:
 *      the book moves between two sequential transactions. Legs are therefore
 *      sent FILL_OR_KILL, so a leg either exists whole or not at all and an
 *      unwind never has to reason about a partial. When a leg fails, every
 *      already-filled leg is sold back and each sale is verified from chain.
 *
 * WHAT THIS IS NOT. It is not atomic. Between the first fill and the unwind
 * there is a real window — a few blocks — in which the position is one-sided,
 * and an unwind crosses a spread and can itself fail. That is a weaker
 * guarantee than 7702 would give, it is the best this chain allows, and the
 * result says so in a FIELD rather than in a comment: `atomicity` is never the
 * string "ATOMIC" here, and the UI prints whatever it holds.
 */

import { getMarketSnapshot, exchange } from "@sdk/venue/markets";
import { resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { chainCapabilities } from "@sdk/venue/capabilities";
import { headroomSec, type EventMarket } from "@sdk/venue/types";
import { placeLimit } from "./place-limit";
import { rpc } from "./execution";
import type { Hex } from "viem";
import {
  decideAtomicity,
  type Atomicity,
  type BatchLeg,
  type LegBlocker,
  type LegOutcome,
  type LegPlan,
  type BatchResult,
  type UnwindOutcome,
} from "./atomicity";

// Re-exported so a caller imports one module, not two.
export {
  decideAtomicity,
  type Atomicity,
  type BatchLeg,
  type LegBlocker,
  type LegOutcome,
  type LegPlan,
  type BatchResult,
  type UnwindOutcome,
};

/* ------------------------------------------------------------------ */
/* 1. Plan — the half that IS all-or-nothing                           */
/* ------------------------------------------------------------------ */

/**
 * Price and gate every leg before anything is signed.
 *
 * Pure planning, so the UI can show the whole structure and its cost before the
 * user commits — and so a doomed batch costs nothing at all.
 */
export async function planBatch(
  legs: BatchLeg[],
  config: VenueConfig = resolveVenueConfig(),
): Promise<LegPlan[]> {
  const snap = await getMarketSnapshot(config);
  const ex = exchange(config);
  const now = Math.floor(Date.now() / 1000);

  const bad = (
    leg: BatchLeg,
    market: EventMarket | null,
    blocker: LegBlocker,
    detail: string,
  ): LegPlan => ({
    leg,
    ok: false,
    blocker,
    detail,
    price: null,
    cost: null,
    symbol: market?.symbol ?? null,
  });

  return Promise.all(
    legs.map(async (leg): Promise<LegPlan> => {
      const m = snap.all.find((x) => x.marketId === leg.marketId) ?? null;
      if (!m) return bad(leg, null, "MARKET_NOT_FOUND", "Not in the current registry.");
      if (m.strike === null)
        return bad(leg, m, "MARKET_UNSTRUCK", "The venue has not struck this window yet.");
      if (m.status !== "Trading")
        return bad(leg, m, "MARKET_NOT_TRADING", `Status is ${m.status}; only Trading accepts orders.`);

      const left = m.expiry - now;
      if (left <= 0) return bad(leg, m, "MARKET_EXPIRED", "This window has closed.");
      const need = headroomSec(m.intervalSec);
      if (left <= need)
        return bad(
          leg,
          m,
          "WITHIN_EXPIRY_HEADROOM",
          `${left}s remain; this window needs ${need}s so a leg cannot lock mid-flight.`,
        );

      if (!(leg.size > 0) || leg.size < m.minAmount)
        return bad(leg, m, "SIZE_BELOW_MINIMUM", `Venue minimum is ${m.minAmount} contracts.`);

      let price = leg.price;
      if (price === undefined) {
        try {
          const ob = await ex.fetchOrderBook(`${m.symbol}#${leg.outcome}`);
          const side = leg.side === "buy" ? ob.asks : ob.bids;
          price = ((side ?? []) as [number, number][])[0]?.[0];
        } catch {
          price = undefined;
        }
      }
      if (price === undefined)
        return bad(leg, m, "NO_BOOK_LIQUIDITY", "Nothing is resting on the side this leg must cross.");

      return {
        leg,
        ok: true,
        price,
        cost: leg.side === "buy" ? price * leg.size : 0,
        symbol: m.symbol,
      };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 2. Execute — sequential, verified, unwound on failure               */
/* ------------------------------------------------------------------ */

/** Send one leg fill-or-kill and read the verdict off the receipt, not the SDK. */
async function sendLeg(plan: LegPlan, config: VenueConfig): Promise<LegOutcome> {
  const evidence: string[] = [];
  const leg = plan.leg;

  try {
    const placed = await placeLimit(
      {
        marketId: leg.marketId,
        outcome: leg.outcome,
        side: leg.side,
        price: plan.price!,
        size: leg.size,
        // All-or-nothing on ONE leg, so an unwind never faces a partial.
        type: "fok",
      },
      config,
    );
    evidence.push(`placeLimit filled ${placed.filled} of ${placed.size} (not trusted)`);

    if (!placed.hash) {
      // A fill-or-kill that took nothing is a clean no-op, not something to
      // recover from: no position was created, so there is nothing to unwind.
      return { leg, status: "KILLED", txHash: null, blockNumber: null, filled: 0, evidence };
    }

    const receipt = await rpc(config)
      .getTransactionReceipt({ hash: placed.hash as Hex })
      .catch(() => null);

    if (!receipt) {
      evidence.push("receipt not yet available — treated as failed; nothing is assumed filled");
      return { leg, status: "FAILED", txHash: placed.hash, blockNumber: null, filled: 0, evidence };
    }

    evidence.push(`receipt.status=${receipt.status} block=${receipt.blockNumber}`);
    const ok = receipt.status === "success" && placed.filled > 0;
    return {
      leg,
      status: ok ? "FILLED" : placed.filled > 0 ? "FAILED" : "KILLED",
      txHash: placed.hash,
      blockNumber: Number(receipt.blockNumber),
      filled: ok ? placed.filled : 0,
      evidence,
    };
  } catch (e) {
    evidence.push(`leg threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    return { leg, status: "FAILED", txHash: null, blockNumber: null, filled: 0, evidence };
  }
}

/**
 * Sell back a leg that filled before the batch failed.
 *
 * Crosses the bid, because the point is to be flat, not to get a good price. A
 * failure here is reported rather than retried in a loop — a retry storm on a
 * moving book is how one bad leg becomes five.
 */
async function unwindLeg(outcome: LegOutcome, config: VenueConfig): Promise<UnwindOutcome> {
  const leg = outcome.leg;
  const reverse: "buy" | "sell" = leg.side === "buy" ? "sell" : "buy";

  try {
    const snap = await getMarketSnapshot(config);
    const m = snap.all.find((x) => x.marketId === leg.marketId);
    if (!m)
      return {
        leg,
        status: "UNWIND_FAILED",
        txHash: null,
        size: outcome.filled,
        detail: "Market left the registry before the unwind could be priced.",
      };

    const ob = await exchange(config).fetchOrderBook(`${m.symbol}#${leg.outcome}`);
    const side = reverse === "sell" ? ob.bids : ob.asks;
    const best = ((side ?? []) as [number, number][])[0]?.[0];
    if (best === undefined)
      return {
        leg,
        status: "UNWIND_FAILED",
        txHash: null,
        size: outcome.filled,
        detail: "Nothing resting to unwind into. The leg is still open.",
      };

    const placed = await placeLimit(
      {
        marketId: leg.marketId,
        outcome: leg.outcome,
        side: reverse,
        price: best,
        size: outcome.filled,
        type: "ioc",
      },
      config,
    );

    if (!placed.hash || placed.filled <= 0)
      return {
        leg,
        status: "UNWIND_FAILED",
        txHash: placed.hash,
        size: outcome.filled,
        detail: "The sell-back took nothing.",
      };

    const receipt = await rpc(config)
      .getTransactionReceipt({ hash: placed.hash as Hex })
      .catch(() => null);

    return receipt?.status === "success"
      ? { leg, status: "UNWOUND", txHash: placed.hash, size: placed.filled, detail: null }
      : {
          leg,
          status: "UNWIND_FAILED",
          txHash: placed.hash,
          size: outcome.filled,
          detail: "The sell-back reverted on-chain.",
        };
  } catch (e) {
    return {
      leg,
      status: "UNWIND_FAILED",
      txHash: null,
      size: outcome.filled,
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 160),
    };
  }
}

/**
 * Open a multi-leg structure.
 *
 * Refuses whole before signing anything; otherwise sends legs in order and
 * unwinds what filled if a later leg fails. Never reports a guarantee stronger
 * than the one it actually delivered.
 */
export async function executeBatch(
  legs: BatchLeg[],
  config: VenueConfig = resolveVenueConfig(),
): Promise<BatchResult> {
  const started = Date.now();
  const caps = await chainCapabilities(config);
  const plans = await planBatch(legs, config);

  const base = {
    plans,
    eip7702Available: caps.eip7702,
    totalCost: plans.every((p) => p.ok)
      ? plans.reduce((n, p) => n + (p.cost ?? 0), 0)
      : null,
  };

  // Nothing is signed unless EVERY leg is routable. This is the real
  // all-or-nothing, and it is where almost every failure is caught.
  if (!plans.every((p) => p.ok) || config.dryRun)
    return {
      ...base,
      atomicity: "PREFLIGHT_ALL_OR_NOTHING",
      outcomes: plans.map((p) => ({
        leg: p.leg,
        status: "NOT_ATTEMPTED" as const,
        txHash: null,
        blockNumber: null,
        filled: 0,
        evidence: [
          config.dryRun
            ? "PRISM_DRY_RUN is true"
            : (p.blocker ?? "another leg blocked the batch"),
        ],
      })),
      unwinds: [],
      elapsedMs: Date.now() - started,
    };

  const outcomes: LegOutcome[] = [];
  let broke = false;

  for (const plan of plans) {
    if (broke) {
      outcomes.push({
        leg: plan.leg,
        status: "NOT_ATTEMPTED",
        txHash: null,
        blockNumber: null,
        filled: 0,
        evidence: ["an earlier leg failed; this leg was never sent"],
      });
      continue;
    }
    const out = await sendLeg(plan, config);
    outcomes.push(out);
    if (out.status !== "FILLED") broke = true;
  }

  if (!broke)
    return {
      ...base,
      atomicity: "SEQUENTIAL_VERIFIED",
      outcomes,
      unwinds: [],
      elapsedMs: Date.now() - started,
    };

  // A leg failed. Put back whatever actually filled, newest first — the most
  // recent fill is the one whose book has moved least.
  const filled = outcomes.filter((o) => o.status === "FILLED" && o.filled > 0).reverse();
  const unwinds: UnwindOutcome[] = [];
  for (const o of filled) unwinds.push(await unwindLeg(o, config));

  return {
    ...base,
    atomicity: decideAtomicity(outcomes, unwinds),
    outcomes,
    unwinds,
    elapsedMs: Date.now() - started,
  };
}
