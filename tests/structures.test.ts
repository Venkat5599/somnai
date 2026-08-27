import { describe, expect, it } from "vitest";
import {
  constructibility,
  maxExpiriesOnOneAsset,
  maxStrikesOnOneExpiry,
  strikesByWindow,
  structureMatrix,
} from "@sdk/venue/structures";
import type { EventMarket } from "@sdk/venue/types";

/**
 * The venue constraint, asserted rather than described.
 *
 * "Range, Spread and Ladder cannot be built here" was checked by hand against
 * the live registry, twice, and then written into prose. These tests turn it
 * into something that fails loudly if the reasoning is ever broken — and, just
 * as importantly, they prove the verdict FLIPS when a second strike appears, so
 * the UI is not hard-coded to a permanent no.
 */

let seq = 0;
const market = (p: Partial<EventMarket> = {}): EventMarket => ({
  marketId: `0x${(++seq).toString(16).padStart(64, "0")}`,
  symbol: "BTC-TEST/tUSDC",
  asset: "BTC",
  strike: 100_000,
  intervalSec: 300,
  interval: "5m",
  tradingStart: 0,
  expiry: 1_000_000,
  status: "Trading",
  active: true,
  finalized: false,
  voided: false,
  venueId: null,
  operatorId: null,
  poolAddress: null,
  nonce: null,
  marketAddress: null,
  yesTokenId: null,
  noTokenId: null,
  question: null,
  collateral: null,
  quoteDecimals: 6,
  pricePrecision: 3,
  amountPrecision: 3,
  minAmount: 0.001,
  tradeCount: 0,
  quoteVolume: 0,
  winningOutcome: null,
  ...p,
});

/** The venue as it actually is: one strike per window, five cadences. */
const dreamdexToday = (): EventMarket[] => [
  market({ asset: "BTC", strike: 100_000, expiry: 1_000, intervalSec: 300, interval: "5m" }),
  market({ asset: "BTC", strike: 100_100, expiry: 1_300, intervalSec: 300, interval: "5m" }),
  market({ asset: "BTC", strike: 100_200, expiry: 1_600, intervalSec: 300, interval: "5m" }),
  market({ asset: "BTC", strike: 101_000, expiry: 4_600, intervalSec: 3600, interval: "1h" }),
  market({ asset: "ETH", strike: 3_000, expiry: 1_000, intervalSec: 300, interval: "5m" }),
];

describe("strike counting", () => {
  it("groups by (asset, expiry), so two assets closing together are two windows", () => {
    const windows = strikesByWindow(dreamdexToday());
    expect(windows.get("BTC|1000")?.size).toBe(1);
    expect(windows.get("ETH|1000")?.size).toBe(1);
    expect(windows.size).toBe(5);
  });

  it("excludes unstruck windows — strike null is not a strike", () => {
    const markets = [
      market({ asset: "BTC", strike: null, expiry: 2_000 }),
      market({ asset: "BTC", strike: null, expiry: 2_000 }),
    ];
    expect(strikesByWindow(markets).size).toBe(0);
    expect(maxStrikesOnOneExpiry(markets)).toBe(0);
  });

  it("counts DISTINCT strikes — the same strike listed twice is still one", () => {
    const markets = [
      market({ asset: "BTC", strike: 100_000, expiry: 5_000 }),
      market({ asset: "BTC", strike: 100_000, expiry: 5_000 }),
    ];
    expect(maxStrikesOnOneExpiry(markets)).toBe(1);
  });

  it("reports at most one strike per expiry on the venue as it stands", () => {
    expect(maxStrikesOnOneExpiry(dreamdexToday())).toBe(1);
  });

  it("reports the real time axis: several expiries on one asset", () => {
    expect(maxExpiriesOnOneAsset(dreamdexToday())).toBe(4);
  });
});

describe("constructibility against DreamDEX as it is", () => {
  const markets = dreamdexToday();

  it("allows DIRECTIONAL — one market, one leg", () => {
    expect(constructibility("DIRECTIONAL", markets).constructible).toBe(true);
  });

  it("allows CALENDAR — one strike carried across a succession chain", () => {
    expect(constructibility("CALENDAR", markets).constructible).toBe(true);
  });

  it.each(["RANGE", "SPREAD", "LADDER"] as const)(
    "refuses %s — it needs two strikes on one expiry and the venue lists one",
    (kind) => {
      const verdict = constructibility(kind, markets);
      expect(verdict.constructible).toBe(false);
      expect(verdict.strikesAvailable).toBe(1);
      expect(verdict.strikesRequired).toBeGreaterThan(1);
      // The sentence must cite the observed number, never assert a bare no.
      expect(verdict.reason).toContain("at most 1");
    },
  );

  it("puts the buildable structures first in the matrix", () => {
    const matrix = structureMatrix(markets);
    expect(matrix.slice(0, 2).map((m) => m.kind).sort()).toEqual(["CALENDAR", "DIRECTIONAL"]);
    expect(matrix.filter((m) => m.constructible)).toHaveLength(2);
  });
});

describe("the verdict is data-driven, not hard-coded", () => {
  /**
   * The point of this block. If DreamDEX lists a second strike on one expiry,
   * Range and Spread become real and PRISM must stop saying they are not. A
   * constraint written in prose could never do this.
   */
  const twoStrikes = (): EventMarket[] => [
    market({ asset: "BTC", strike: 100_000, expiry: 9_000 }),
    market({ asset: "BTC", strike: 105_000, expiry: 9_000 }),
  ];

  it("turns RANGE and SPREAD on the moment a second strike appears", () => {
    expect(maxStrikesOnOneExpiry(twoStrikes())).toBe(2);
    expect(constructibility("RANGE", twoStrikes()).constructible).toBe(true);
    expect(constructibility("SPREAD", twoStrikes()).constructible).toBe(true);
  });

  it("still refuses LADDER at two strikes — three is the minimum that is not a spread", () => {
    expect(constructibility("LADDER", twoStrikes()).constructible).toBe(false);
  });

  it("turns LADDER on at three strikes", () => {
    const three = [...twoStrikes(), market({ asset: "BTC", strike: 110_000, expiry: 9_000 })];
    expect(constructibility("LADDER", three).constructible).toBe(true);
  });

  it("refuses CALENDAR when only one expiry exists, however many strikes it has", () => {
    const verdict = constructibility("CALENDAR", twoStrikes());
    expect(verdict.constructible).toBe(false);
    expect(verdict.reason).toContain("expiries");
  });

  it("refuses everything against an empty registry rather than defaulting to yes", () => {
    for (const v of structureMatrix([])) expect(v.constructible).toBe(false);
  });
});
