/**
 * What a binary is worth when nothing is resting on your side.
 *
 * The terminal used to dead-end whenever the selected outcome had no ask:
 * "No resting offer on YES — nothing to price against." That sentence is
 * false. A binary needs no model and no counterparty to be priced, because
 * YES and NO on one window are the SAME instrument seen from two sides:
 *
 *     price(YES) + price(NO) = 1
 *
 * So a bid on NO is an implied ask on YES, exactly and arithmetically. A book
 * that looks empty from one side is very often fully quoted from the other,
 * and this venue's books are one-sided most of the time. Refusing to draw the
 * payoff in that state threw away information the page had already fetched.
 *
 * This module is the single place that answers "what is this outcome worth
 * right now, and how do I know". It is pure and lives outside `server-only`
 * so the cascade is testable — the previous version could not be tested at
 * all, because it was an inline `price === null` branch inside a component.
 */

/** One side of one outcome's book. Asks are what you lift to buy. */
export interface BookSide {
  /** Asks, best-first: [price, size]. */
  levels: [number, number][];
  /** Bids, best-first: [price, size]. */
  bids: [number, number][];
  /** Best ask, or null when nothing is offered. */
  best: number | null;
  /** Best bid, or null when nothing is wanted. */
  bid: number | null;
  /** Contracts offered across all ask levels. */
  depth: number;
  /** Contracts wanted across all bid levels. */
  bidDepth: number;
}

export interface MarketBook {
  YES: BookSide;
  NO: BookSide;
}

export const emptySide = (): BookSide => ({
  levels: [],
  bids: [],
  best: null,
  bid: null,
  depth: 0,
  bidDepth: 0,
});

export const emptyBook = (): MarketBook => ({ YES: emptySide(), NO: emptySide() });

/**
 * Where a mark came from. The UI prints this — an inferred price that looks
 * like an executable one is worse than no price at all.
 */
export type MarkSource =
  /** Resting ask on this outcome. You can pay this. */
  | "ask"
  /** 1 − best bid on the other outcome. An implied ask, not routable here. */
  | "implied-ask"
  /** Resting bid on this outcome. What you would be paid, a lower bound. */
  | "bid"
  /** 1 − best ask on the other outcome. An implied bid, a lower bound. */
  | "implied-bid";

export interface Mark {
  price: number;
  source: MarkSource;
  /** True only when this exact price is lift-able on this outcome right now. */
  executable: boolean;
}

/** A probability has to sit strictly inside (0,1) to define a payoff. */
function usable(p: number | null | undefined): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 0 && p < 1;
}

/**
 * The cascade, ordered by economic distance from "what buying costs".
 *
 * 1. The ask on this side — the real price, executable.
 * 2. The complement of the other side's bid — the same trade priced by
 *    someone who wrote it as the opposite leg. Arithmetically an ask.
 * 3. This side's bid — a floor on value, not a cost.
 * 4. The complement of the other side's ask — the same floor, inferred.
 *
 * Returns null ONLY when both outcomes are completely unquoted, which is a
 * genuinely priceless state and the one case the payoff must render unpriced.
 */
export function markPrice(book: MarketBook, outcome: "YES" | "NO"): Mark | null {
  const side = book[outcome];
  const other = book[outcome === "YES" ? "NO" : "YES"];

  if (usable(side.best)) return { price: side.best, source: "ask", executable: true };

  if (usable(other.bid)) {
    const p = 1 - other.bid;
    if (usable(p)) return { price: p, source: "implied-ask", executable: false };
  }

  if (usable(side.bid)) return { price: side.bid, source: "bid", executable: false };

  if (usable(other.best)) {
    const p = 1 - other.best;
    if (usable(p)) return { price: p, source: "implied-bid", executable: false };
  }

  return null;
}

/** One line of provenance, for printing under an inferred number. */
export function markProvenance(mark: Mark, outcome: "YES" | "NO"): string {
  const opposite = outcome === "YES" ? "NO" : "YES";
  switch (mark.source) {
    case "ask":
      return `Resting offer on ${outcome}. This is what a contract costs.`;
    case "implied-ask":
      return `Implied from the ${opposite} bid — a binary's two sides sum to 1. Nothing is offered on ${outcome}, so this is a price, not a fill.`;
    case "bid":
      return `From the ${outcome} bid — what the book would pay you. Nothing is offered, so it bounds value rather than costing it.`;
    case "implied-bid":
      return `Implied from the ${opposite} offer — a binary's two sides sum to 1. It bounds value; no contract is offered on ${outcome}.`;
  }
}

/**
 * Which outcome to open on.
 *
 * Executable depth wins, because a side you can actually trade beats a side
 * you can only look at. Only when NEITHER side is offered does a mark decide,
 * and YES breaks a true tie because the venue quotes in YES terms.
 */
export function openingOutcome(book: MarketBook): "YES" | "NO" {
  if (book.YES.depth > 0 || book.NO.depth > 0)
    return book.NO.depth > book.YES.depth ? "NO" : "YES";
  if (markPrice(book, "YES")) return "YES";
  if (markPrice(book, "NO")) return "NO";
  return "YES";
}
