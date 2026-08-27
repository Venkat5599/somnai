/**
 * Quote construction for the resting strategies.
 *
 * Deliberately NOT server-only, for the same reason as grid.ts: this is pure
 * arithmetic on probabilities, it decides what price real money rests at, and
 * it is the part that most needs testing. A maker that computes a bid ABOVE its
 * ask, or a price outside (0,1), does not throw — it sends, and the venue takes
 * whichever side of the crossed pair is free money.
 *
 * THE BINARY SPECIFICS THAT MAKE THIS NOT A NORMAL MAKER:
 *
 *   - A price here is a PROBABILITY, strictly inside (0,1). There is no "just
 *     widen the spread" at the edges: a fair of 0.02 has only two ticks of room
 *     underneath it, so quotes must be clamped rather than reflected.
 *
 *   - The book is quoted in YES terms whichever leg you trade, so a maker's two
 *     sides are buy-YES and sell-YES rather than two different outcomes.
 *
 *   - Every window expires in minutes. A quote that outlives its window is not
 *     merely stale, it is escrow locked in a market that has settled, so the
 *     runner flattens inside the venue's own expiry headroom.
 */

import type { Outcome } from "@sdk/venue/types";

export type QuoteStrategy = "ec-market-maker" | "ec-passive-bid" | "ec-ladder";

export interface DesiredQuote {
  outcome: Outcome;
  side: "buy" | "sell";
  /** Probability strictly inside (0,1), already clamped to the tick grid's edges. */
  price: number;
  size: number;
}

export interface QuoteParams {
  /** Mid probability the quotes are built around. */
  fair: number;
  /** Total width between bid and ask, in probability. */
  spread: number;
  /** Contracts per quote. */
  size: number;
  /** Levels per side, for the ladder. */
  levels?: number;
  /** Distance between ladder levels, in probability. */
  step?: number;
  /** Venue tick, used to bound how close to 0 or 1 a quote may sit. */
  tick: number;
}

/**
 * Hold a probability strictly inside (0,1), one tick clear of each edge.
 *
 * Not a cosmetic clamp: `placeLimit` throws outside (0,1) after snapping, and a
 * price of exactly 0 or 1 is not a probability the venue will accept. Coming
 * back with the nearest legal price is better than dropping the quote, because
 * a maker asked to quote a 0.01 market should still quote it.
 */
export function clampProbability(p: number, tick: number): number {
  const edge = Math.max(tick, 1e-6);
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1 - edge, Math.max(edge, p));
}

/**
 * The quotes a strategy wants resting right now.
 *
 * Pure: given the same inputs it returns the same orders, so the runner can
 * compare what it wants against what is on the book without a network call.
 */
export function desiredQuotes(
  strategy: QuoteStrategy,
  params: QuoteParams,
): DesiredQuote[] {
  const { fair, spread, size, tick } = params;
  if (!(size > 0)) return [];

  const half = Math.max(tick, spread / 2);
  const bid = clampProbability(fair - half, tick);
  const ask = clampProbability(fair + half, tick);

  // A pair closer than one tick is not a spread the venue can express: both
  // sides snap to the same on-grid price and the maker trades against itself.
  //
  // Tested as a SEPARATION, not as `bid >= ask`. Because each side is clamped a
  // full tick clear of its edge and half is itself floored at a tick, a literal
  // crossing is essentially unreachable — that guard looked right and never
  // fired. What does happen is COMPRESSION: at fair 0.996 with a 0.01 spread
  // the ask clamps down to 0.995 while the bid sits at 0.991, four thousandths
  // apart on a five-thousandth grid. Quoting one side is the honest answer.
  const crossed = ask - bid < tick;

  if (strategy === "ec-passive-bid") {
    // One resting bid, and it never pays the spread — so it sits at the bid,
    // never at fair.
    return [{ outcome: "YES", side: "buy", price: bid, size }];
  }

  if (strategy === "ec-market-maker") {
    if (crossed) return [{ outcome: "YES", side: "buy", price: bid, size }];
    return [
      { outcome: "YES", side: "buy", price: bid, size },
      { outcome: "YES", side: "sell", price: ask, size },
    ];
  }

  // Ladder: levels stepping outward from the touch on each side.
  const levels = Math.max(1, Math.floor(params.levels ?? 3));
  const step = Math.max(tick, params.step ?? tick * 2);
  const out: DesiredQuote[] = [];

  for (let i = 0; i < levels; i++) {
    const b = clampProbability(bid - i * step, tick);
    out.push({ outcome: "YES", side: "buy", price: b, size });
  }
  if (!crossed) {
    for (let i = 0; i < levels; i++) {
      const a = clampProbability(ask + i * step, tick);
      out.push({ outcome: "YES", side: "sell", price: a, size });
    }
  }

  // Two levels can clamp onto the same price near an edge; sending both would
  // rest duplicate orders at one price for no benefit.
  const seen = new Set<string>();
  return out.filter((q) => {
    const key = `${q.side}@${q.price.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Has fair moved enough to be worth re-quoting?
 *
 * Re-quoting means cancel plus place: two transactions, two nonces, and the
 * loss of price-time priority. Doing that on every tick for a fair that moved
 * by less than the venue can even express is pure cost, and on a shared nonce
 * it starves everything else. The threshold is half a tick because a smaller
 * move snaps to the same on-grid price anyway — the new order would be
 * identical to the one it replaced.
 */
export function shouldRequote(
  previousFair: number | null,
  fair: number,
  tick: number,
): boolean {
  if (previousFair === null) return true;
  // Compared with a tolerance, not bare >=. A move of exactly half a tick
  // computes as 0.0024999999999999467 against a 0.0025 threshold in binary
  // floating point, so the strict form stands pat on precisely the move that
  // should re-quote — and keeps standing pat while fair drifts a half tick at
  // a time, never re-quoting at all.
  return Math.abs(fair - previousFair) >= tick / 2 - 1e-12;
}

/**
 * Fair probability from the two sides of the book.
 *
 * Falls back to whichever side exists, because these books are frequently
 * one-sided — and a maker that refuses to quote until both sides are populated
 * would never quote at all on this venue. Returns null only when the book is
 * empty on both sides, where there is genuinely nothing to anchor to.
 */
export function fairFromBook(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid !== null && bestAsk !== null) return (bestBid + bestAsk) / 2;
  if (bestAsk !== null) return bestAsk;
  if (bestBid !== null) return bestBid;
  return null;
}
