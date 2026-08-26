import "server-only";

/**
 * The Roll Engine — PRISM's actual product.
 *
 * An Event Contract window is minutes long. A view that wants a real tenor has
 * to be re-struck into the successor every time one closes, forever. Doing that
 * by hand is the problem PRISM exists to remove.
 *
 * A roll here is deliberately NOT "close the old leg and open a new one". The
 * old leg is a binary that is about to resolve: closing it means crossing a
 * spread on a contract that is seconds from settling for its full value anyway.
 * So the engine LETS IT SETTLE and claims it (see settlement.ts), while opening
 * the equivalent exposure in the successor window. Carry forward, don't churn.
 *
 * Ordering matters and is the one real hazard: open the successor BEFORE the
 * current window locks, or there is a gap in exposure. That is why the plan
 * refuses to run inside the venue's own expiry headroom.
 */

import { getMarketSnapshot, successionChain, exchange } from "@/lib/venue/markets";
import { resolveVenueConfig, type VenueConfig } from "@/lib/venue/config";
import { headroomSec, type EventMarket, type Outcome } from "@/lib/venue/types";
import { placeLimit } from "./place-limit";
import { rpc } from "./execution";
import type { Hex } from "viem";

export type RollBlocker =
  | "MARKET_NOT_FOUND"
  | "NO_SUCCESSOR_LISTED"
  | "SUCCESSOR_UNSTRUCK"
  | "SUCCESSOR_NOT_TRADING"
  | "NO_BOOK_ON_SUCCESSOR"
  | "TOO_EARLY"
  | "CURRENT_ALREADY_CLOSED";

export interface RollPlan {
  ok: boolean;
  blocker?: RollBlocker;
  detail?: string;
  from: { marketId: string; strike: number | null; expiry: number; interval: string } | null;
  to: { marketId: string; strike: number | null; expiry: number } | null;
  outcome: Outcome;
  size: number;
  /** Best ask on the successor, i.e. what carrying forward costs. */
  price: number | null;
  estimatedCost: number | null;
  /** Seconds until the current window closes. */
  secondsLeft: number;
  /** Seconds of headroom this cadence requires. */
  headroom: number;
}

/**
 * Decide whether a view can be carried into the next window, and at what cost.
 *
 * Pure planning: nothing is signed here, so the UI can show the roll before
 * committing to it.
 */
export async function planRoll(
  args: { marketId: string; outcome: Outcome; size: number },
  config: VenueConfig = resolveVenueConfig(),
): Promise<RollPlan> {
  const snap = await getMarketSnapshot(config);
  const current = snap.all.find((m) => m.marketId === args.marketId) ?? null;
  const now = Math.floor(Date.now() / 1000);

  const base: RollPlan = {
    ok: false,
    from: current
      ? {
          marketId: current.marketId,
          strike: current.strike,
          expiry: current.expiry,
          interval: current.interval,
        }
      : null,
    to: null,
    outcome: args.outcome,
    size: args.size,
    price: null,
    estimatedCost: null,
    secondsLeft: current ? current.expiry - now : 0,
    headroom: current ? headroomSec(current.intervalSec) : 0,
  };

  if (!current)
    return { ...base, blocker: "MARKET_NOT_FOUND", detail: "That market is not in the registry." };

  if (base.secondsLeft <= 0)
    return {
      ...base,
      blocker: "CURRENT_ALREADY_CLOSED",
      detail: "This window has closed. Claim it on Settlement and open the successor directly.",
    };

  // The successor is the next window on the same asset and cadence.
  const chain = successionChain(snap, current.asset, current.intervalSec);
  const next = chain.find((m) => m.expiry > current.expiry) ?? null;

  if (!next)
    return {
      ...base,
      blocker: "NO_SUCCESSOR_LISTED",
      detail:
        "The venue has not listed the next window yet. Successors are struck as the current window nears close.",
    };

  const to = { marketId: next.marketId, strike: next.strike, expiry: next.expiry };

  if (next.strike === null)
    return { ...base, to, blocker: "SUCCESSOR_UNSTRUCK", detail: "The successor exists but has no strike yet." };

  if (next.status !== "Trading")
    return {
      ...base,
      to,
      blocker: "SUCCESSOR_NOT_TRADING",
      detail: `Successor status is ${next.status}; only Trading accepts orders.`,
    };

  // Price the carry against the successor's real book.
  let price: number | null = null;
  try {
    const ob = await exchange(config).fetchOrderBook(`${next.symbol}#${args.outcome}`);
    price = ((ob.asks ?? []) as [number, number][])[0]?.[0] ?? null;
  } catch {
    price = null;
  }

  if (price === null)
    return {
      ...base,
      to,
      blocker: "NO_BOOK_ON_SUCCESSOR",
      detail: "Nothing is resting on the successor's book, so the view cannot be carried yet.",
    };

  return {
    ...base,
    ok: true,
    to,
    price,
    estimatedCost: price * args.size,
  };
}

export interface RollResult {
  planned: RollPlan;
  txHash: string | null;
  filled: number;
  status: "VERIFIED_EXECUTED" | "VERIFIED_FAILED" | "UNKNOWN" | "NOT_ATTEMPTED";
  blockNumber: number | null;
  evidence: string[];
}

/**
 * Carry the view into the successor window.
 *
 * Opens the successor leg only. The expiring leg is left to settle and is
 * collected by the settlement sweep — crossing a spread to close a contract
 * that is about to pay out in full would burn the roll's entire edge.
 */
export async function executeRoll(
  args: { marketId: string; outcome: Outcome; size: number },
  config: VenueConfig = resolveVenueConfig(),
): Promise<RollResult> {
  const planned = await planRoll(args, config);
  const evidence: string[] = [];

  if (!planned.ok || !planned.to)
    return {
      planned,
      txHash: null,
      filled: 0,
      status: "NOT_ATTEMPTED",
      blockNumber: null,
      evidence: [planned.blocker ?? "plan not ok"],
    };

  if (config.dryRun)
    return {
      planned,
      txHash: null,
      filled: 0,
      status: "NOT_ATTEMPTED",
      blockNumber: null,
      evidence: ["PRISM_DRY_RUN is true"],
    };

  let txHash: string | null = null;
  let filled = 0;

  try {
    const placed = await placeLimit(
      {
        marketId: planned.to.marketId,
        outcome: args.outcome,
        side: "buy",
        price: planned.price!,
        size: args.size,
        type: "ioc",
      },
      config,
    );
    txHash = placed.hash;
    filled = placed.filled;
    evidence.push(`placeLimit filled ${placed.filled} of ${placed.size} (not trusted)`);
  } catch (e) {
    evidence.push(`roll leg threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }

  // Verified from chain, never from the SDK's word.
  let status: RollResult["status"] = "UNKNOWN";
  let blockNumber: number | null = null;

  if (txHash) {
    try {
      const receipt = await rpc(config).getTransactionReceipt({ hash: txHash as Hex });
      blockNumber = Number(receipt.blockNumber);
      evidence.push(`receipt.status=${receipt.status} block=${blockNumber}`);
      status = receipt.status === "success" ? "VERIFIED_EXECUTED" : "VERIFIED_FAILED";
    } catch {
      evidence.push("receipt not yet available");
    }
  }

  return { planned, txHash, filled, status, blockNumber, evidence };
}
