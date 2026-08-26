/**
 * PRISM quant core.
 *
 * A DreamDEX Event Contract is a cash-or-nothing digital: it pays 1 USDso if the
 * underlying is above `strike` at window expiry, 0 otherwise. Its mid price is
 * therefore the risk-neutral probability P(S_T > K) = N(d2).
 *
 * That makes a strip of Event Contracts across strikes a *basis*. Any terminal
 * payoff on the strike grid can be written as a weighted sum of digitals
 * (Breeden-Litzenberger, 1978), which is exactly what the replication router
 * below solves for.
 *
 * Everything here is pure and deterministic so the UI can render the same
 * numbers the executor will sign.
 */

/** Abramowitz & Stegun 26.2.17 — max abs error 7.5e-8. */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Inverse normal CDF — Acklam's rational approximation. */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** d2 for a lognormal spot. */
export function d2(spot: number, strike: number, vol: number, years: number) {
  if (years <= 0 || vol <= 0) return spot > strike ? 40 : -40;
  return (
    (Math.log(spot / strike) - 0.5 * vol * vol * years) / (vol * Math.sqrt(years))
  );
}

/** Risk-neutral P(S_T > K). This is the fair "Up" price of an Event Contract. */
export function digitalUp(
  spot: number,
  strike: number,
  vol: number,
  years: number,
): number {
  return normCdf(d2(spot, strike, vol, years));
}

/** Plausible vol band. Anything outside this is a numerical artefact. */
const VOL_MIN = 0.02;
const VOL_MAX = 3;

/**
 * Recover implied vol from a traded Up price, by inverting N(d2).
 *
 * Closed form: m - 0.5 s^2 T = z s sqrt(T) is a quadratic in s, so no root
 * search is needed. But the inversion is only usable away from the money.
 *
 * At the money, log(S/K) is ~0 and d2 collapses to -0.5 s sqrt(T), so the
 * digital price sits near 0.5 almost regardless of sigma. The quadratic still
 * has a root there, and that root is enormous and meaningless: a price of 0.405
 * on a four hour window "solves" to a vol of 2200%. Reporting it would be
 * worse than reporting nothing, so rungs inside the ill-conditioned zone return
 * null and the caller interpolates across them.
 *
 * `seedVol` only sets the width of that zone; it does not bias the answer.
 */
export function impliedVolFromDigital(
  spot: number,
  strike: number,
  up: number,
  years: number,
  seedVol = 0.4,
): number | null {
  if (years <= 0 || !(spot > 0) || !(strike > 0)) return null;

  const m = Math.log(spot / strike);
  const sd = seedVol * Math.sqrt(years);

  // Inside roughly half a standard deviation of the money the price carries
  // almost no information about sigma. Refuse rather than invent.
  if (Math.abs(m) < 0.45 * sd) return null;

  const z = normInv(Math.min(Math.max(up, 1e-6), 1 - 1e-6));
  const A = 0.5 * years;
  const B = z * Math.sqrt(years);
  const C = -m;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;

  const s = (-B + Math.sqrt(disc)) / (2 * A);
  if (!Number.isFinite(s) || s < VOL_MIN || s > VOL_MAX) return null;

  // Re-price and reject anything that does not round trip.
  if (Math.abs(digitalUp(spot, strike, s, years) - up) > 5e-4) return null;
  return s;
}

/**
 * Fill the ill-conditioned gap in a vol slice.
 *
 * Walks the strike axis and linearly interpolates every null between two known
 * rungs, then flat-extends past the outermost known values. The result is a
 * continuous slice with no hole at the money and no invented wing.
 */
export function repairVolSlice(vols: (number | null)[]): number[] {
  const n = vols.length;
  const out = vols.slice();
  const known = out
    .map((v, i) => (v === null ? -1 : i))
    .filter((i) => i >= 0);

  if (known.length === 0) return new Array(n).fill(0);
  if (known.length === 1) return new Array(n).fill(out[known[0]] as number);

  for (let i = 0; i < n; i++) {
    if (out[i] !== null) continue;
    const before = [...known].reverse().find((k) => k < i);
    const after = known.find((k) => k > i);
    if (before === undefined) out[i] = out[after!];
    else if (after === undefined) out[i] = out[before];
    else {
      const t = (i - before) / (after - before);
      out[i] = (out[before] as number) + t * ((out[after] as number) - (out[before] as number));
    }
  }
  return out as number[];
}

/* ------------------------------------------------------------------ */
/* Risk-neutral density                                                */
/* ------------------------------------------------------------------ */

export interface LadderRung {
  strike: number;
  /** Traded mid probability that spot finishes above `strike`. */
  up: number;
}

export interface DensityPoint {
  strike: number;
  /** Survival function P(S > K) — monotone decreasing after repair. */
  survival: number;
  /** Risk-neutral density q(K) = -d/dK P(S > K). */
  density: number;
}

/**
 * Enforce the no-arbitrage shape of the strip, then differentiate it.
 *
 * The traded ladder is noisy: two adjacent Event Contracts can cross so that a
 * higher strike shows a higher Up price, which implies a negative probability.
 * A pool-adjacent-violators pass repairs monotonicity before we differentiate,
 * because a raw finite difference on a crossed ladder produces a density with
 * negative lobes and the whole surface becomes unreadable.
 */
export function riskNeutralDensity(ladder: LadderRung[]): DensityPoint[] {
  const rungs = [...ladder].sort((a, b) => a.strike - b.strike);
  if (rungs.length < 2) return [];

  // Pool adjacent violators — survival must be non-increasing in strike.
  const s = rungs.map((r) => Math.min(Math.max(r.up, 0), 1));
  const w = rungs.map(() => 1);
  for (let i = 1; i < s.length; i++) {
    while (i > 0 && s[i - 1] < s[i]) {
      const total = w[i - 1] + w[i];
      const pooled = (s[i - 1] * w[i - 1] + s[i] * w[i]) / total;
      s.splice(i - 1, 2, pooled);
      w.splice(i - 1, 2, total);
      rungs.splice(i - 1, 2, rungs[i - 1]);
      i--;
    }
  }

  // Re-expand the pooled runs back onto the original strike grid.
  const survival: number[] = [];
  let cursor = 0;
  for (let k = 0; k < w.length; k++) {
    for (let j = 0; j < w[k]; j++) survival[cursor++] = s[k];
  }

  const grid = [...ladder].sort((a, b) => a.strike - b.strike);
  return grid.map((r, i) => {
    const sv = survival[i] ?? r.up;
    let density = 0;
    if (i > 0 && i < grid.length - 1) {
      const dk = grid[i + 1].strike - grid[i - 1].strike;
      density = dk > 0 ? -((survival[i + 1] ?? 0) - (survival[i - 1] ?? 1)) / dk : 0;
    } else if (i === 0 && grid.length > 1) {
      const dk = grid[1].strike - grid[0].strike;
      density = dk > 0 ? -((survival[1] ?? 0) - sv) / dk : 0;
    } else if (i > 0) {
      const dk = grid[i].strike - grid[i - 1].strike;
      density = dk > 0 ? -(sv - (survival[i - 1] ?? 1)) / dk : 0;
    }
    return { strike: r.strike, survival: sv, density: Math.max(density, 0) };
  });
}

/* ------------------------------------------------------------------ */
/* Replication                                                         */
/* ------------------------------------------------------------------ */

export type Side = "UP" | "DOWN";

export interface Leg {
  /** Signed contract count. Positive = long the outcome. */
  weight: number;
  side: Side;
  strike: number;
  /** Traded probability paid or received per contract. */
  price: number;
  /** Cash flow now. Negative = you pay. */
  cost: number;
  /** Book depth at this level, in contracts. */
  depth: number;
}

export type StructureKind =
  | "DIRECTIONAL"
  | "RANGE"
  | "SPREAD"
  | "LADDER"
  | "CALENDAR";

export interface ReplicationRequest {
  kind: StructureKind;
  ladder: LadderRung[];
  lower?: number;
  upper?: number;
  /** Contracts of notional the user wants at the peak of the payoff. */
  size: number;
  /** Depth available per rung, in contracts. */
  depthByStrike: Record<number, number>;
}

export interface Replication {
  legs: Leg[];
  /** Net cash out now, positive number = you pay this. */
  cost: number;
  /** Best-case terminal value. */
  maxPayout: number;
  /** maxPayout / cost - 1. */
  potentialReturn: number;
  /** Fraction of requested size the book can actually fill. */
  fillRatio: number;
  /** Breakeven strikes, ascending. */
  breakevens: number[];
}

const nearest = (ladder: LadderRung[], k: number) =>
  ladder.reduce((best, r) =>
    Math.abs(r.strike - k) < Math.abs(best.strike - k) ? r : best,
  );

/**
 * Decompose a payoff intent into Event Contract legs.
 *
 * A range "spot finishes between L and U" is long the Up at L and short the Up
 * at U: the two digitals net to 1 exactly on the interval and 0 outside it.
 * A directional view is a single Up leg. A ladder spreads the notional across
 * the rungs so that no single thin book has to absorb the whole order.
 */
export function replicate(req: ReplicationRequest): Replication {
  const { ladder, size, depthByStrike } = req;
  const legs: Leg[] = [];

  const push = (weight: number, side: Side, rung: LadderRung) => {
    const price = side === "UP" ? rung.up : 1 - rung.up;
    legs.push({
      weight,
      side,
      strike: rung.strike,
      price,
      cost: -weight * price,
      depth: depthByStrike[rung.strike] ?? 0,
    });
  };

  switch (req.kind) {
    case "RANGE": {
      const lo = nearest(ladder, req.lower ?? ladder[0].strike);
      const hi = nearest(ladder, req.upper ?? ladder[ladder.length - 1].strike);
      push(size, "UP", lo);
      push(-size, "UP", hi);
      break;
    }
    case "SPREAD": {
      const lo = nearest(ladder, req.lower ?? ladder[0].strike);
      const hi = nearest(ladder, req.upper ?? ladder[ladder.length - 1].strike);
      push(size, "UP", lo);
      push(-size * 0.5, "UP", hi);
      break;
    }
    case "LADDER": {
      const lo = req.lower ?? ladder[0].strike;
      const hi = req.upper ?? ladder[ladder.length - 1].strike;
      const inner = ladder.filter((r) => r.strike >= lo && r.strike <= hi);
      const each = inner.length ? size / inner.length : 0;
      inner.forEach((r) => push(each, "UP", r));
      break;
    }
    case "CALENDAR": {
      // A calendar holds ONE strike and carries it across window succession.
      // Within a single window it is a single long leg; the tenor comes from
      // the roll, not from a second outcome. Pairing long Up with short Down
      // at the same strike would be a synthetic forward, which is a different
      // trade with a negative premium and an unbounded downside.
      const k = nearest(ladder, req.lower ?? ladder[Math.floor(ladder.length / 2)].strike);
      push(size, "UP", k);
      break;
    }
    case "DIRECTIONAL":
    default: {
      const k = nearest(ladder, req.lower ?? ladder[Math.floor(ladder.length / 2)].strike);
      push(size, "UP", k);
      break;
    }
  }

  // Liquidity constraint: the router can only fill against real resting depth.
  const worstFill = legs.reduce((worst, l) => {
    const need = Math.abs(l.weight);
    if (need <= 0) return worst;
    const can = l.depth > 0 ? Math.min(1, l.depth / need) : 1;
    return Math.min(worst, can);
  }, 1);

  const scaled = legs.map((l) => ({
    ...l,
    weight: l.weight * worstFill,
    cost: l.cost * worstFill,
  }));

  const cost = -scaled.reduce((sum, l) => sum + l.cost, 0);
  const grid = ladder.map((r) => r.strike);
  const lo = grid[0] - (grid[1] - grid[0]);
  const hi = grid[grid.length - 1] + (grid[grid.length - 1] - grid[grid.length - 2]);
  const samples = 240;
  let maxPayout = 0;
  const values: { s: number; v: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = lo + ((hi - lo) * i) / samples;
    const v = payoffAt(scaled, s);
    values.push({ s, v });
    if (v > maxPayout) maxPayout = v;
  }

  const breakevens: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1].v - cost;
    const b = values[i].v - cost;
    if (a === 0) breakevens.push(values[i - 1].s);
    else if (a * b < 0) {
      const t = a / (a - b);
      breakevens.push(values[i - 1].s + t * (values[i].s - values[i - 1].s));
    }
  }

  return {
    legs: scaled,
    cost,
    maxPayout,
    potentialReturn: cost > 0 ? maxPayout / cost - 1 : 0,
    fillRatio: worstFill,
    breakevens,
  };
}

/** Terminal value of a leg set at settlement price `s`. */
export function payoffAt(legs: Leg[], s: number): number {
  return legs.reduce((sum, l) => {
    const hit = l.side === "UP" ? (s > l.strike ? 1 : 0) : s <= l.strike ? 1 : 0;
    return sum + l.weight * hit;
  }, 0);
}

/** Sampled net P&L curve (terminal value minus premium paid). */
export function payoffCurve(
  legs: Leg[],
  cost: number,
  from: number,
  to: number,
  samples = 320,
): { s: number; pnl: number }[] {
  const out: { s: number; pnl: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = from + ((to - from) * i) / samples;
    out.push({ s, pnl: payoffAt(legs, s) - cost });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Venue arithmetic — the sharp edges from the DreamDEX gotchas doc    */
/* ------------------------------------------------------------------ */

/**
 * Snap a probability to the venue tick grid using integer arithmetic.
 *
 * The SDK's generic converter runs `parseUnits(price.toFixed(18), 18)`, and
 * `(0.05).toFixed(18)` is "0.050000000000000003" — three wei off the grid,
 * which the pool rejects with InvalidPrice. Quantising in tick units first
 * avoids the float entirely.
 */
export function quantizePrice(p: number, tick: number): number {
  const ticks = Math.round(p / tick);
  return Number((ticks * tick).toFixed(12));
}

/** Snap a size to the venue lot grid, rounding down so we never overfill. */
export function quantizeSize(q: number, lot: number): number {
  const lots = Math.floor(q / lot + 1e-9);
  return Number((lots * lot).toFixed(12));
}

/** Expiry headroom scales to the window, not a fixed threshold. */
export function headroomSec(intervalSec: number): number {
  return Math.max(5, Math.round(intervalSec * 0.08));
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const fmtUsd = (n: number, dp = 2) =>
  (n < 0 ? "-" : "") +
  "$" +
  Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export const fmtSigned = (n: number, dp = 2) =>
  (n >= 0 ? "+" : "-") +
  "$" +
  Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

export const fmtPct = (n: number, dp = 1) =>
  `${(n * 100).toFixed(dp)}%`;

export const fmtSignedPct = (n: number, dp = 1) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`;

export const fmtProb = (n: number) => n.toFixed(3);

export const fmtK = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `${n}`;

export const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return fmtUsd(n, 0);
};
