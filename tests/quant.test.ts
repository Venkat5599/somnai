/**
 * The payoff core.
 *
 * These are the numbers a user commits money against, so the boundaries matter
 * more than the happy path. Every function here is pure and React-free.
 */

import { describe, expect, it } from "vitest";
import {
  digitalUp,
  normCdf,
  normInv,
  payoffAt,
  quantizePrice,
  quantizeSize,
  replicate,
  riskNeutralDensity,
  type Leg,
} from "@/lib/quant";

describe("normCdf / normInv", () => {
  it("is symmetric about zero", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1) + normCdf(-1)).toBeCloseTo(1, 6);
  });

  it("round-trips through the inverse", () => {
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(normCdf(normInv(p))).toBeCloseTo(p, 4);
    }
  });
});

describe("digitalUp", () => {
  it("approaches 1 far above the strike and 0 far below", () => {
    expect(digitalUp(200_000, 79_000, 0.4, 1 / 365)).toBeGreaterThan(0.99);
    expect(digitalUp(20_000, 79_000, 0.4, 1 / 365)).toBeLessThan(0.01);
  });

  it("collapses to a step function at zero time", () => {
    expect(digitalUp(80_000, 79_000, 0.4, 0)).toBe(1);
    expect(digitalUp(78_000, 79_000, 0.4, 0)).toBe(0);
  });
});

describe("payoffAt — binary settlement", () => {
  const legs: Leg[] = [
    { weight: 100, side: "UP", strike: 109_000, price: 0.87, cost: -87, depth: 500 },
    { weight: -100, side: "UP", strike: 111_000, price: 0.06, cost: 6, depth: 500 },
  ];

  it("pays zero below the lower strike", () => {
    expect(payoffAt(legs, 108_000)).toBe(0);
  });

  it("pays the full notional inside the band", () => {
    expect(payoffAt(legs, 110_000)).toBe(100);
  });

  it("nets to zero above the upper strike", () => {
    expect(payoffAt(legs, 112_000)).toBe(0);
  });

  it("is exclusive at the strike itself — above, not at", () => {
    // A digital pays when spot finishes ABOVE the strike, so the boundary
    // itself is out of the money. Getting this wrong misprices every rung.
    expect(payoffAt(legs, 109_000)).toBe(0);
    expect(payoffAt(legs, 109_000.01)).toBe(100);
  });
});

describe("quantisation to the venue grid", () => {
  it("snaps a price in integer tick units", () => {
    // The float path is the documented failure: (0.05).toFixed(18) is
    // "0.050000000000000003", three wei off the grid, rejected as InvalidPrice.
    expect(quantizePrice(0.05, 0.005)).toBe(0.05);
    expect(quantizePrice(0.0537, 0.005)).toBe(0.055);
    expect(quantizePrice(0.0512, 0.005)).toBe(0.05);
  });

  it("rounds size DOWN so an order can never overfill", () => {
    expect(quantizeSize(9.99, 1)).toBe(9);
    expect(quantizeSize(10, 1)).toBe(10);
    expect(quantizeSize(0.4, 1)).toBe(0);
  });
});

describe("riskNeutralDensity", () => {
  it("repairs a crossed ladder so no density lobe goes negative", () => {
    // Rungs 2 and 3 cross: a higher strike shows a higher Up price, which
    // implies a negative probability. PAVA must pool them.
    const out = riskNeutralDensity([
      { strike: 100, up: 0.9 },
      { strike: 110, up: 0.5 },
      { strike: 120, up: 0.6 },
      { strike: 130, up: 0.1 },
    ]);
    expect(out).toHaveLength(4);
    for (const p of out) expect(p.density).toBeGreaterThanOrEqual(0);
    // Survival must be non-increasing after repair.
    for (let i = 1; i < out.length; i++) {
      expect(out[i].survival).toBeLessThanOrEqual(out[i - 1].survival + 1e-9);
    }
  });

  it("returns nothing for a strip too short to differentiate", () => {
    expect(riskNeutralDensity([{ strike: 100, up: 0.5 }])).toEqual([]);
  });
});

describe("replicate — depth constraint", () => {
  const ladder = [
    { strike: 100, up: 0.9 },
    { strike: 110, up: 0.5 },
    { strike: 120, up: 0.2 },
  ];

  it("scales the whole structure to the thinnest leg", () => {
    const r = replicate({
      kind: "RANGE",
      ladder,
      lower: 100,
      upper: 120,
      size: 1000,
      depthByStrike: { 100: 250, 110: 1000, 120: 1000 },
    });
    // Only a quarter of the requested size can rest at the 100 rung.
    expect(r.fillRatio).toBeCloseTo(0.25, 6);
    for (const l of r.legs) expect(Math.abs(l.weight)).toBeLessThanOrEqual(250);
  });

  it("fills completely when every rung is deep enough", () => {
    const r = replicate({
      kind: "RANGE",
      ladder,
      lower: 100,
      upper: 120,
      size: 100,
      depthByStrike: { 100: 5000, 110: 5000, 120: 5000 },
    });
    expect(r.fillRatio).toBe(1);
  });

  it("produces a single leg for a directional view", () => {
    const r = replicate({
      kind: "DIRECTIONAL",
      ladder,
      lower: 110,
      size: 10,
      depthByStrike: { 100: 999, 110: 999, 120: 999 },
    });
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].side).toBe("UP");
  });
});
