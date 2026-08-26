/**
 * Routability and expiry guards.
 *
 * These decide whether an order may be signed at all, so they are the cheapest
 * place to prevent a real transaction being sent at a market that cannot fill.
 * Pure functions, no network, no mocked chain.
 */

import { describe, expect, it } from "vitest";
import {
  headroomSec,
  isRoutable,
  secondsToExpiry,
  withinHeadroom,
  type EventMarket,
} from "@/lib/venue/types";

const NOW = 1_787_700_000_000; // fixed clock; nothing here reads Date.now()
const nowSec = Math.floor(NOW / 1000);

function market(over: Partial<EventMarket> = {}): EventMarket {
  return {
    marketId: "0xabc",
    symbol: "BTC-7903451-26AUG26-0335/tUSDC",
    asset: "BTC",
    strike: 79034.51,
    intervalSec: 300,
    interval: "5m",
    tradingStart: nowSec - 60,
    expiry: nowSec + 240,
    status: "Trading",
    active: true,
    finalized: false,
    voided: false,
    venueId: "0xvenue",
    operatorId: 4,
    poolAddress: "0xpool",
    nonce: 1,
    marketAddress: "0xmarket",
    yesTokenId: "1",
    noTokenId: "2",
    question: null,
    collateral: "0xtusdc",
    quoteDecimals: 6,
    pricePrecision: 3,
    amountPrecision: 3,
    minAmount: 0.001,
    tradeCount: 0,
    quoteVolume: 0,
    winningOutcome: null,
    ...over,
  };
}

describe("headroomSec", () => {
  it("scales to the window rather than using a fixed threshold", () => {
    // A flat 300s rule would reject every 5m market on this venue.
    expect(headroomSec(300)).toBe(24);
    expect(headroomSec(3600)).toBe(288);
    expect(headroomSec(86400)).toBe(6912);
  });

  it("never drops below five seconds", () => {
    expect(headroomSec(1)).toBe(5);
    expect(headroomSec(0)).toBe(5);
  });
});

describe("secondsToExpiry", () => {
  it("is positive before expiry and negative after", () => {
    expect(secondsToExpiry(market({ expiry: nowSec + 90 }), NOW)).toBe(90);
    expect(secondsToExpiry(market({ expiry: nowSec - 30 }), NOW)).toBe(-30);
  });
});

describe("isRoutable", () => {
  it("accepts a struck, trading, active market with room left", () => {
    expect(isRoutable(market(), NOW)).toBe(true);
  });

  it("rejects an unstruck window", () => {
    // strike 0 on the wire normalises to null: the window exists but the venue
    // has not struck it. Eight of ten live markets were in this state.
    expect(isRoutable(market({ strike: null }), NOW)).toBe(false);
  });

  it("rejects a market the venue does not report as Trading", () => {
    for (const status of ["Listed", "Locked", "Settling", "Resolved", "Voided"]) {
      expect(isRoutable(market({ status }), NOW)).toBe(false);
    }
  });

  it("rejects inactive, finalized or voided markets", () => {
    expect(isRoutable(market({ active: false }), NOW)).toBe(false);
    expect(isRoutable(market({ finalized: true }), NOW)).toBe(false);
    expect(isRoutable(market({ voided: true }), NOW)).toBe(false);
  });

  it("rejects an expired window", () => {
    expect(isRoutable(market({ expiry: nowSec - 1 }), NOW)).toBe(false);
  });
});

describe("withinHeadroom", () => {
  it("is true once the window is too close to close to send safely", () => {
    // 5m window needs 24s of headroom.
    expect(withinHeadroom(market({ expiry: nowSec + 20 }), NOW)).toBe(true);
    expect(withinHeadroom(market({ expiry: nowSec + 25 }), NOW)).toBe(false);
  });

  it("treats an already-expired window as inside headroom", () => {
    expect(withinHeadroom(market({ expiry: nowSec - 5 }), NOW)).toBe(true);
  });
});
