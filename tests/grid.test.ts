/**
 * The 18-decimal grid bug, and the fix.
 *
 * These tests exist because the failure is invisible on testnet. Shannon is a
 * 6-decimal venue, so `parseUnits(price.toFixed(6), 6)` lands exactly on the
 * grid every time and the unified tier looks perfect. At 18 decimals the same
 * code exposes the float's binary representation and the pool rejects the order
 * with `InvalidPrice`.
 *
 * So the first assertion below deliberately REPRODUCES the bug, to prove the
 * test is measuring something real, and the rest prove `toSteps` is immune.
 */

import { describe, expect, it } from "vitest";
import { gridFor, toSteps } from "@sdk/dreamdex/grid";

const ONE_18 = 10n ** 18n;
const ONE_6 = 10n ** 6n;
const TICK_18 = 1_000_000_000_000_000n; // 0.001 at 18dp
const TICK_6 = 1_000n; // 0.001 at 6dp
const LOT_6 = 1n;

describe("the bug this module exists to avoid", () => {
  it("toFixed(18) really does drift off the tick grid", () => {
    // This is the documented failure, reproduced in plain JS.
    expect((0.05).toFixed(18)).toBe("0.050000000000000003");

    // Which is three wei past an exact 0.05 at 18 decimals.
    const drifted = BigInt((0.05).toFixed(18).replace(".", ""));
    const exact = 5n * 10n ** 16n;
    expect(drifted - exact).toBe(3n);

    // And three wei is NOT a multiple of the tick, so the pool rejects it.
    expect(drifted % TICK_18).not.toBe(0n);
  });

  it("only the exactly-representable probabilities survive the float path", () => {
    const survives = (p: number) =>
      BigInt(p.toFixed(18).replace(".", "")) % TICK_18 === 0n;

    // Binary floating point represents these exactly.
    expect(survives(0.25)).toBe(true);
    expect(survives(0.5)).toBe(true);
    expect(survives(0.75)).toBe(true);

    // Ordinary probabilities do not.
    expect(survives(0.05)).toBe(false);
    expect(survives(0.07)).toBe(false);
  });
});

describe("toSteps — grid-exact at any decimals", () => {
  it("lands exactly on the tick grid at 18 decimals", () => {
    for (const p of [0.05, 0.07, 0.123, 0.331, 0.953, 0.999]) {
      const out = toSteps(p, ONE_18, TICK_18, "round");
      expect(out % TICK_18).toBe(0n);
    }
  });

  it("puts 0.05 exactly where the float path could not", () => {
    expect(toSteps(0.05, ONE_18, TICK_18, "round")).toBe(5n * 10n ** 16n);
  });

  it("is exact at 6 decimals too", () => {
    expect(toSteps(0.953, ONE_6, TICK_6, "round")).toBe(953_000n);
    expect(toSteps(0.05, ONE_6, TICK_6, "round")).toBe(50_000n);
  });

  it("rounds prices to the nearest tick", () => {
    // 0.0534 sits between ticks; nearest is 0.053.
    expect(toSteps(0.0534, ONE_6, TICK_6, "round")).toBe(53_000n);
    expect(toSteps(0.0536, ONE_6, TICK_6, "round")).toBe(54_000n);
  });

  it("floors sizes so an order can never exceed what was asked", () => {
    expect(toSteps(9.9999, ONE_6, LOT_6 * 1_000_000n, "floor")).toBe(9_000_000n);
    expect(toSteps(1, ONE_6, LOT_6 * 1_000_000n, "floor")).toBe(1_000_000n);
  });

  it("never returns a negative quantity", () => {
    expect(toSteps(-5, ONE_6, TICK_6, "round")).toBe(0n);
  });
});

describe("NO price is the complement, on-grid", () => {
  it("stays exactly on the grid via integer subtraction", () => {
    // The book is quoted in YES terms whichever leg you trade.
    for (const p of [0.05, 0.331, 0.953]) {
      const own = toSteps(p, ONE_18, TICK_18, "round");
      const yes = ONE_18 - own;
      expect(yes % TICK_18).toBe(0n);
      expect(yes + own).toBe(ONE_18);
    }
  });
});

describe("gridFor", () => {
  it("uses an 18-decimal grid on mainnet and a 6-decimal one on testnet", () => {
    expect(gridFor("mainnet").tick).toBe(1_000_000_000_000_000n);
    expect(gridFor("testnet").tick).toBe(1_000n);
    expect(gridFor("testnet").lot).toBe(1n);
  });
});
