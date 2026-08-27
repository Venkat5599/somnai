import { describe, expect, it } from "vitest";
import {
  clampProbability,
  desiredQuotes,
  fairFromBook,
  shouldRequote,
  type QuoteParams,
} from "@sdk/dreamdex/quotes";

/**
 * A maker that quotes wrong does not throw — it rests, and the venue takes
 * whichever side of a crossed pair is free money. These assert the failures
 * that only show up with real size on a real book.
 */

const TICK = 0.005;
const base = (over: Partial<QuoteParams> = {}): QuoteParams => ({
  fair: 0.5,
  spread: 0.04,
  size: 1,
  tick: TICK,
  ...over,
});

describe("a price is a probability, not a number", () => {
  it("keeps every quote strictly inside (0,1)", () => {
    for (const fair of [0.001, 0.01, 0.5, 0.98, 0.999]) {
      for (const strat of ["ec-market-maker", "ec-passive-bid", "ec-ladder"] as const) {
        for (const q of desiredQuotes(strat, base({ fair, spread: 0.2 }))) {
          expect(q.price, `${strat} @ fair ${fair}`).toBeGreaterThan(0);
          expect(q.price, `${strat} @ fair ${fair}`).toBeLessThan(1);
        }
      }
    }
  });

  it("clamps to one tick clear of each edge rather than dropping the quote", () => {
    // A maker asked to quote a 0.01 market should still quote it.
    expect(clampProbability(-5, TICK)).toBe(TICK);
    expect(clampProbability(9, TICK)).toBe(1 - TICK);
    expect(clampProbability(0, TICK)).toBe(TICK);
    expect(clampProbability(1, TICK)).toBe(1 - TICK);
  });

  it("returns a usable mid rather than NaN for a broken fair", () => {
    expect(clampProbability(NaN, TICK)).toBe(0.5);
  });
});

describe("the maker never crosses itself", () => {
  it("puts the bid strictly below the ask at a normal fair", () => {
    const [bid, ask] = desiredQuotes("ec-market-maker", base());
    expect(bid.side).toBe("buy");
    expect(ask.side).toBe("sell");
    expect(bid.price).toBeLessThan(ask.price);
  });

  it("quotes one side when the clamp compresses the pair below a tick", () => {
    // At fair 0.996 the ask clamps down to 0.995 while the bid sits at 0.991 —
    // four thousandths apart on a five-thousandth grid, so both would snap to
    // the same on-grid price and the maker would trade against itself.
    const q = desiredQuotes("ec-market-maker", base({ fair: 0.996, spread: 0.01 }));
    expect(q).toHaveLength(1);
    expect(q[0].side).toBe("buy");
  });

  it("still quotes both sides near an edge when there is room for a real spread", () => {
    // A wide spread at a low fair is NOT compressed: the bid clamps up to the
    // edge while the ask stays far above it.
    const q = desiredQuotes("ec-market-maker", base({ fair: 0.001, spread: 0.5 }));
    expect(q).toHaveLength(2);
    expect(q[0].price).toBeLessThan(q[1].price);
  });

  it("never lets the spread collapse below one tick", () => {
    const [bid, ask] = desiredQuotes("ec-market-maker", base({ spread: 0 }));
    expect(ask.price - bid.price).toBeGreaterThanOrEqual(TICK);
  });

  it("quotes both sides in YES terms, because the book is quoted that way", () => {
    for (const q of desiredQuotes("ec-market-maker", base())) expect(q.outcome).toBe("YES");
  });
});

describe("passive bid", () => {
  it("rests exactly one order, on the bid", () => {
    const q = desiredQuotes("ec-passive-bid", base());
    expect(q).toHaveLength(1);
    expect(q[0].side).toBe("buy");
  });

  it("never pays the spread — it sits below fair, never at it", () => {
    const [q] = desiredQuotes("ec-passive-bid", base({ fair: 0.5, spread: 0.04 }));
    expect(q.price).toBeLessThan(0.5);
  });
});

describe("ladder", () => {
  it("steps outward from the touch on both sides", () => {
    const q = desiredQuotes("ec-ladder", base({ levels: 3, step: 0.01 }));
    const bids = q.filter((x) => x.side === "buy").map((x) => x.price);
    const asks = q.filter((x) => x.side === "sell").map((x) => x.price);
    expect(bids).toHaveLength(3);
    expect(asks).toHaveLength(3);
    // Bids descend, asks ascend.
    expect([...bids].sort((a, b) => b - a)).toEqual(bids);
    expect([...asks].sort((a, b) => a - b)).toEqual(asks);
    expect(Math.max(...bids)).toBeLessThan(Math.min(...asks));
  });

  it("never rests two orders at the same price when levels clamp together", () => {
    // Near an edge, several levels collapse onto the same clamped price.
    const q = desiredQuotes("ec-ladder", base({ fair: 0.006, levels: 5, step: 0.01 }));
    const keys = q.map((x) => `${x.side}@${x.price}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("treats a zero or negative level count as one level", () => {
    expect(desiredQuotes("ec-ladder", base({ levels: 0 })).length).toBeGreaterThan(0);
  });
});

describe("no size means no orders", () => {
  it.each(["ec-market-maker", "ec-passive-bid", "ec-ladder"] as const)(
    "%s quotes nothing at size zero",
    (s) => {
      expect(desiredQuotes(s, base({ size: 0 }))).toEqual([]);
      expect(desiredQuotes(s, base({ size: -1 }))).toEqual([]);
    },
  );
});

describe("re-quoting is a cost, not a reflex", () => {
  it("quotes on the first pass, when there is no previous fair", () => {
    expect(shouldRequote(null, 0.5, TICK)).toBe(true);
  });

  it("stands pat when fair moved less than half a tick", () => {
    // The replacement order would snap to the same on-grid price, so cancelling
    // and re-placing spends two nonces to arrive where it already was.
    expect(shouldRequote(0.5, 0.5 + TICK / 4, TICK)).toBe(false);
    expect(shouldRequote(0.5, 0.5, TICK)).toBe(false);
  });

  it("re-quotes once the move is at least half a tick, either way", () => {
    expect(shouldRequote(0.5, 0.5 + TICK / 2, TICK)).toBe(true);
    expect(shouldRequote(0.5, 0.5 - TICK, TICK)).toBe(true);
  });
});

describe("fair, on a venue whose books are usually one-sided", () => {
  it("takes the mid when both sides exist", () => {
    expect(fairFromBook(0.4, 0.6)).toBeCloseTo(0.5);
  });

  it("falls back to whichever side exists rather than refusing to quote", () => {
    // These books are frequently one-sided. A maker that waits for both would
    // never quote at all here.
    expect(fairFromBook(null, 0.42)).toBe(0.42);
    expect(fairFromBook(0.42, null)).toBe(0.42);
  });

  it("returns null only when there is genuinely nothing to anchor to", () => {
    expect(fairFromBook(null, null)).toBeNull();
  });
});
