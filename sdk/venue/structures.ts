/**
 * Which structures this venue can actually express — decided from the registry,
 * not from a paragraph.
 *
 * The claim "Range, Spread and Ladder are impossible here" was true, verified
 * twice by hand, and written into prose in three places. Prose does not re-check
 * itself. If DreamDEX ever lists a second strike on one expiry, three screens
 * and a README would go on saying it had not, and the only way anyone would
 * find out is by reading the registry themselves.
 *
 * THE RULE, stated once and executable. A payoff that needs to distinguish two
 * price regions on the SAME expiry needs two strikes on that expiry: a Range
 * pays between K1 and K2, a Spread is long one strike and short another, a
 * Ladder is a monotone strip of them. A digital at a single strike cannot make
 * that distinction at any size, so the requirement is structural, not a
 * liquidity problem that a bigger book would fix.
 *
 * What the venue does give is FIVE cadences on one asset — 5m/15m/1h/4h/24h —
 * so composition along TIME is real. That is why Calendar is constructible and
 * why PRISM's product is the roll rather than the ladder.
 *
 * Pure and dependency-free so both the server page and the tests can call it.
 */

import type { EventMarket } from "./types";

export type StructureKind = "DIRECTIONAL" | "CALENDAR" | "RANGE" | "SPREAD" | "LADDER";

/** Distinct strikes a structure needs on ONE expiry to be expressible at all. */
export const STRIKES_REQUIRED: Record<StructureKind, number> = {
  /** One market, one leg. */
  DIRECTIONAL: 1,
  /** One strike carried across a succession chain — composes on time, not strike. */
  CALENDAR: 1,
  /** Pays between K1 and K2. */
  RANGE: 2,
  /** Long one strike, short another, same expiry. */
  SPREAD: 2,
  /** A monotone strip; two is the minimum that is not just a spread. */
  LADDER: 3,
};

/** Distinct expiries a structure needs on one asset. */
export const EXPIRIES_REQUIRED: Record<StructureKind, number> = {
  DIRECTIONAL: 1,
  CALENDAR: 2,
  RANGE: 1,
  SPREAD: 1,
  LADDER: 1,
};

/**
 * Group struck markets by the window they belong to.
 *
 * The key is (asset, expiry) rather than (asset, interval, expiry): two
 * cadences that happen to close at the same second are still two different
 * windows to the venue, but for the purpose of "can I build a spread" what
 * matters is only that the legs settle on the same observation.
 *
 * Unstruck markets are excluded — `strike: null` is the venue saying it has not
 * priced the window, and counting it would inflate the answer with a strike
 * that does not exist yet.
 */
export function strikesByWindow(markets: EventMarket[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const m of markets) {
    if (m.strike === null) continue;
    const key = `${m.asset}|${m.expiry}`;
    let set = out.get(key);
    if (!set) out.set(key, (set = new Set()));
    set.add(m.strike);
  }
  return out;
}

/** The most distinct strikes the venue has ever put on one expiry, right now. */
export function maxStrikesOnOneExpiry(markets: EventMarket[]): number {
  let max = 0;
  for (const strikes of strikesByWindow(markets).values())
    if (strikes.size > max) max = strikes.size;
  return max;
}

/** The most distinct expiries available on one asset. */
export function maxExpiriesOnOneAsset(markets: EventMarket[]): number {
  const byAsset = new Map<string, Set<number>>();
  for (const m of markets) {
    let set = byAsset.get(m.asset);
    if (!set) byAsset.set(m.asset, (set = new Set()));
    set.add(m.expiry);
  }
  let max = 0;
  for (const s of byAsset.values()) if (s.size > max) max = s.size;
  return max;
}

export interface Constructibility {
  kind: StructureKind;
  constructible: boolean;
  strikesRequired: number;
  strikesAvailable: number;
  expiriesRequired: number;
  expiriesAvailable: number;
  /** A sentence the UI can print verbatim. Always cites the observed numbers. */
  reason: string;
}

/**
 * Can this structure be built against the registry as it stands?
 *
 * Answers from live counts, so the day the venue lists a second strike this
 * flips on its own and the UI stops claiming otherwise.
 */
export function constructibility(
  kind: StructureKind,
  markets: EventMarket[],
): Constructibility {
  const strikesRequired = STRIKES_REQUIRED[kind];
  const expiriesRequired = EXPIRIES_REQUIRED[kind];
  const strikesAvailable = maxStrikesOnOneExpiry(markets);
  const expiriesAvailable = maxExpiriesOnOneAsset(markets);

  const strikesOk = strikesAvailable >= strikesRequired;
  const expiriesOk = expiriesAvailable >= expiriesRequired;

  // Counts are pluralised because these strings are rendered verbatim in the
  // UI; "1 strikes" reads as a template that nobody finished.
  const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const reason = !strikesOk
    ? `Needs ${s(strikesRequired, "strike")} on one expiry; the venue lists at most ` +
      `${strikesAvailable} across ${s(markets.length, "market")}, so this cannot be routed here.`
    : !expiriesOk
      ? `Needs ${s(expiriesRequired, "expiry", "expiries")} on one asset; only ` +
        `${expiriesAvailable} listed.`
      : `Constructible: ${s(strikesAvailable, "strike")} on one expiry and ` +
        `${s(expiriesAvailable, "expiry", "expiries")} per asset meet the ` +
        `${strikesRequired}/${expiriesRequired} requirement.`;

  return {
    kind,
    constructible: strikesOk && expiriesOk,
    strikesRequired,
    strikesAvailable,
    expiriesRequired,
    expiriesAvailable,
    reason,
  };
}

/** Every structure, with its live verdict. Ordered buildable-first. */
export function structureMatrix(markets: EventMarket[]): Constructibility[] {
  const kinds: StructureKind[] = ["DIRECTIONAL", "CALENDAR", "RANGE", "SPREAD", "LADDER"];
  return kinds
    .map((k) => constructibility(k, markets))
    .sort((a, b) => Number(b.constructible) - Number(a.constructible));
}
