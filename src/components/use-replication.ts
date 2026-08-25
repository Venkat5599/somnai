"use client";

import { useMemo } from "react";
import {
  replicate,
  riskNeutralDensity,
  payoffCurve,
  quantizePrice,
  quantizeSize,
  type StructureKind,
} from "@/lib/quant";
import {
  depthMapFor,
  ladderFor,
  SPOT,
  type ExpiryLabel,
} from "@/lib/data";

export { TICK, LOT } from "@/lib/venue";
import { TICK, LOT } from "@/lib/venue";

export interface BuilderState {
  asset: "BTC" | "ETH";
  expiry: ExpiryLabel;
  kind: StructureKind;
  lower: number;
  upper: number;
  size: number;
}

export function useReplication(state: BuilderState) {
  const { asset, expiry, kind, lower, upper, size } = state;

  return useMemo(() => {
    const ladder = ladderFor(asset, expiry);
    const depth = depthMapFor(asset, expiry);
    const spot = SPOT[asset].price;

    const rep = replicate({
      kind,
      ladder,
      lower,
      upper,
      size: quantizeSize(size, LOT),
      depthByStrike: depth,
    });

    // Prices go to the executor already snapped to the venue tick grid, so the
    // number on screen is the number that gets signed.
    const legs = rep.legs.map((l) => ({
      ...l,
      price: quantizePrice(l.price, TICK),
      weight: quantizeSize(Math.abs(l.weight), LOT) * Math.sign(l.weight),
    }));

    // Net premium: positive means the structure costs you money to open.
    const netCost = legs.reduce((s, l) => s + l.weight * l.price, 0);

    const lo = ladder[0].strike - (ladder[1].strike - ladder[0].strike) * 1.5;
    const hi =
      ladder[ladder.length - 1].strike +
      (ladder[ladder.length - 1].strike - ladder[ladder.length - 2].strike) * 1.5;

    const curve = payoffCurve(legs, netCost, lo, hi);
    const density = riskNeutralDensity(ladder);

    const notional = Math.abs(netCost);
    const slippage = 1 - rep.fillRatio;
    const availableLiquidity = legs.reduce(
      (s, l) => s + (l.depth ?? 0) * l.price,
      0,
    );

    return {
      ladder,
      spot,
      legs,
      cost: netCost,
      maxPayout: rep.maxPayout,
      potentialReturn: netCost > 0 ? rep.maxPayout / netCost - 1 : 0,
      fillRatio: rep.fillRatio,
      breakevens: rep.breakevens,
      curve,
      density,
      notional,
      slippage,
      availableLiquidity,
      range: [lo, hi] as [number, number],
    };
  }, [asset, expiry, kind, lower, upper, size]);
}
