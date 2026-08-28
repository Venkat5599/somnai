import { describe, it, expect } from "vitest";
// Imported from normalize.ts, NOT markets.ts: the latter is `server-only` and
// throws the moment vitest touches it. That is exactly why this logic was
// extracted — while it lived in markets.ts the function deciding which markets
// exist was the one function in the read path that could not be tested.
import { classifyRow, normalizeMarket } from "../sdk/venue/normalize";
import { compareAssets, KNOWN_ASSETS } from "../sdk/venue/types";

/**
 * Discovery must not decide what the venue is allowed to list.
 *
 * `Asset` was `"BTC" | "ETH"` and `normalizeMarket` returned `null` for anything
 * else — so a third underlying would have been discarded with no log, no
 * counter and no test. That is the same failure the `INTERVALS` constant caused:
 * a hand-written list of what the venue happened to be running quietly became a
 * filter on what PRISM could see.
 *
 * The important assertions here are the ones that PASS on a third underlying.
 * A test that only agrees BTC and ETH work is indistinguishable from the broken
 * version — exactly the point `structures.test.ts` makes about a constraint that
 * can only ever answer "no".
 */

/** A minimal registry row in the shape the SDK actually returns. */
const row = (over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => ({
  type: "binary",
  id: "0xrow",
  symbol: "SYM/tUSDC",
  precision: { price: 3, amount: 3 },
  limits: { amount: { min: 0.001 } },
  active: true,
  ...over,
  info: {
    marketId: "0xmarket",
    asset: "BTC",
    intervalSec: 300,
    interval: "5m",
    strike: "247368",
    tradingStart: 1,
    expiry: 2,
    status: "Trading",
    ...info,
  },
});

describe("normalizeMarket — the underlying belongs to the venue", () => {
  it("keeps BTC", () => {
    expect(normalizeMarket(row({}, { asset: "BTC" }))?.asset).toBe("BTC");
  });

  it("keeps ETH", () => {
    expect(normalizeMarket(row({}, { asset: "ETH" }))?.asset).toBe("ETH");
  });

  /* --- the assertions that would have failed before the fix --- */

  it("keeps a THIRD underlying the venue lists", () => {
    const m = normalizeMarket(row({}, { asset: "SOL" }));
    expect(m).not.toBeNull();
    expect(m?.asset).toBe("SOL");
  });

  it("keeps an underlying nobody has heard of, including a long ticker", () => {
    expect(normalizeMarket(row({}, { asset: "WIFHAT" }))?.asset).toBe("WIFHAT");
  });

  it("does not require the underlying to be in KNOWN_ASSETS", () => {
    const m = normalizeMarket(row({}, { asset: "SOL" }));
    expect(KNOWN_ASSETS).not.toContain("SOL");
    expect(m).not.toBeNull();
  });
});

describe("normalizeMarket — what it must still reject", () => {
  it("rejects a non-binary row", () => {
    expect(classifyRow(row({ type: "spot" }))).toEqual({ ok: false, reason: "NOT_BINARY" });
  });

  it("rejects a row with no market id", () => {
    const r = row({ id: "" }, { marketId: "" });
    expect(classifyRow(r)).toEqual({ ok: false, reason: "NO_MARKET_ID" });
  });

  it("rejects a missing underlying", () => {
    expect(classifyRow(row({}, { asset: undefined }))).toEqual({ ok: false, reason: "NO_ASSET" });
  });

  it("rejects a blank or whitespace underlying — not the same as a new one", () => {
    expect(classifyRow(row({}, { asset: "" }))).toEqual({ ok: false, reason: "NO_ASSET" });
    expect(classifyRow(row({}, { asset: "   " }))).toEqual({ ok: false, reason: "NO_ASSET" });
  });

  it("rejects a non-string underlying", () => {
    expect(classifyRow(row({}, { asset: 42 }))).toEqual({ ok: false, reason: "NO_ASSET" });
  });

  it("rejects a row with no usable cadence", () => {
    expect(classifyRow(row({}, { intervalSec: 0 }))).toEqual({ ok: false, reason: "NO_INTERVAL" });
    expect(classifyRow(row({}, { intervalSec: -5 }))).toEqual({ ok: false, reason: "NO_INTERVAL" });
  });
});

describe("classifyRow — every rejection names itself", () => {
  /**
   * The counter is the whole point. Dropping used to be a bare `null`, so a row
   * PRISM could not read left no trace anywhere and the loss was invisible by
   * construction. A reason is what lets `getMarketSnapshot` tally it and the
   * deploy probe notice.
   */
  it("returns a machine-readable reason rather than null", () => {
    const v = classifyRow(row({}, { asset: "" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(typeof v.reason).toBe("string");
  });

  it("returns the market itself on success", () => {
    const v = classifyRow(row());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.market.marketId).toBe("0xmarket");
  });

  it("agrees with normalizeMarket on every input", () => {
    for (const r of [row(), row({ type: "spot" }), row({}, { asset: "" }), row({}, { asset: "SOL" })]) {
      const v = classifyRow(r);
      expect(normalizeMarket(r)).toEqual(v.ok ? v.market : null);
    }
  });
});

describe("compareAssets — known first, then stable", () => {
  it("orders BTC before ETH", () => {
    expect(compareAssets("BTC", "ETH")).toBeLessThan(0);
  });

  it("puts an unknown underlying after both known ones", () => {
    expect(compareAssets("BTC", "SOL")).toBeLessThan(0);
    expect(compareAssets("SOL", "ETH")).toBeGreaterThan(0);
  });

  it("orders two unknowns alphabetically so the UI does not shuffle", () => {
    expect(compareAssets("AVAX", "SOL")).toBeLessThan(0);
    expect(compareAssets("SOL", "AVAX")).toBeGreaterThan(0);
  });

  it("sorts a mixed list deterministically", () => {
    expect(["SOL", "ETH", "AVAX", "BTC"].sort(compareAssets)).toEqual([
      "BTC",
      "ETH",
      "AVAX",
      "SOL",
    ]);
  });
});
