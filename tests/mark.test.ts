import { describe, it, expect } from "vitest";
import {
  emptyBook,
  emptySide,
  markPrice,
  markProvenance,
  openingOutcome,
  type BookSide,
  type MarketBook,
} from "../sdk/venue/mark";

/**
 * The defect these tests exist for.
 *
 * /trade rendered "No resting offer on YES — nothing to price against" with a
 * dead Buy button, on a window that was STRUCK and had a live countdown. The
 * old code read one number — this outcome's best ask — and treated its absence
 * as the absence of a price. On a binary that is simply false: the two
 * outcomes sum to 1, so a quote on either leg prices both.
 *
 * The assertions that matter are the ones that PASS on a one-sided book. A
 * suite that only proves a two-sided book works is indistinguishable from the
 * broken version.
 */

const side = (p: Partial<BookSide>): BookSide => ({ ...emptySide(), ...p });

const bookOf = (yes: Partial<BookSide>, no: Partial<BookSide>): MarketBook => ({
  YES: side(yes),
  NO: side(no),
});

describe("markPrice", () => {
  it("uses the resting ask on this outcome, and calls it executable", () => {
    const m = markPrice(bookOf({ best: 0.42, depth: 100 }, {}), "YES");
    expect(m).toEqual({ price: 0.42, source: "ask", executable: true });
  });

  it("prices an outcome with NO offer from the other leg's bid", () => {
    // The exact live state from the screenshot: nothing offered on YES.
    const m = markPrice(bookOf({}, { bid: 0.3, bidDepth: 40 }), "YES");
    expect(m?.price).toBeCloseTo(0.7, 12);
    expect(m?.source).toBe("implied-ask");
    expect(m?.executable).toBe(false);
  });

  it("falls back to this outcome's own bid before the other leg's ask", () => {
    const m = markPrice(bookOf({ bid: 0.55 }, { best: 0.6 }), "YES");
    expect(m).toEqual({ price: 0.55, source: "bid", executable: false });
  });

  it("prices from the other leg's ask as a last resort", () => {
    const m = markPrice(bookOf({}, { best: 0.65, depth: 10 }), "YES");
    expect(m?.price).toBeCloseTo(0.35, 12);
    expect(m?.source).toBe("implied-bid");
  });

  it("is symmetric — NO is priced from YES exactly the same way", () => {
    const m = markPrice(bookOf({ bid: 0.25 }, {}), "NO");
    expect(m?.price).toBeCloseTo(0.75, 12);
    expect(m?.source).toBe("implied-ask");
  });

  it("returns null ONLY when both legs are completely unquoted", () => {
    expect(markPrice(emptyBook(), "YES")).toBeNull();
    expect(markPrice(emptyBook(), "NO")).toBeNull();
  });

  it("rejects degenerate quotes rather than drawing an impossible payoff", () => {
    // A 0 or 1 quote is not a probability, and its complement is the other
    // extreme — both produce a payoff with a zero-height arm.
    expect(markPrice(bookOf({ best: 0 }, {}), "YES")).toBeNull();
    expect(markPrice(bookOf({ best: 1 }, {}), "YES")).toBeNull();
    expect(markPrice(bookOf({}, { bid: 1 }), "YES")).toBeNull();
    expect(markPrice(bookOf({}, { bid: 0 }), "YES")).toBeNull();
    expect(markPrice(bookOf({ best: Number.NaN }, {}), "YES")).toBeNull();
  });

  it("skips a degenerate leg and keeps cascading", () => {
    const m = markPrice(bookOf({ bid: 0.4 }, { bid: 0 }), "YES");
    expect(m).toEqual({ price: 0.4, source: "bid", executable: false });
  });
});

describe("markProvenance", () => {
  it("never describes an inferred price as a cost", () => {
    const inferred = markPrice(bookOf({}, { bid: 0.3 }), "YES")!;
    const text = markProvenance(inferred, "YES");
    expect(text).toContain("NO");
    expect(text.toLowerCase()).not.toContain("what a contract costs");
  });

  it("says plainly that a resting ask IS the cost", () => {
    const real = markPrice(bookOf({ best: 0.42 }, {}), "YES")!;
    expect(markProvenance(real, "YES")).toContain("costs");
  });
});

describe("openingOutcome", () => {
  it("opens on the side with the most executable depth, not on YES by default", () => {
    // The old rule was `YES.depth > 0 || NO.depth === 0`, so ONE lot on YES
    // beat any amount on NO.
    expect(openingOutcome(bookOf({ best: 0.5, depth: 1 }, { best: 0.5, depth: 900 }))).toBe("NO");
  });

  it("still prefers YES when YES is the deeper side", () => {
    expect(openingOutcome(bookOf({ best: 0.5, depth: 900 }, { best: 0.5, depth: 1 }))).toBe("YES");
  });

  it("opens on the only offered side", () => {
    expect(openingOutcome(bookOf({}, { best: 0.6, depth: 25 }))).toBe("NO");
  });

  it("with no offers anywhere, opens on a side that can at least be priced", () => {
    // YES is unpriceable here only if NO is too — the complement makes both
    // priceable — so this asserts the tie-break, not the cascade.
    expect(openingOutcome(bookOf({}, { bid: 0.3, bidDepth: 5 }))).toBe("YES");
  });

  it("falls back to YES on a wholly empty book", () => {
    expect(openingOutcome(emptyBook())).toBe("YES");
  });
});
