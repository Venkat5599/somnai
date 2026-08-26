import "server-only";

/**
 * The scaling layer.
 *
 * MEASURED: getMarketSnapshot() takes 1.2-4.9s and was called on every page
 * render with no caching. The registry is IDENTICAL for every user — there is
 * no reason any two visitors should each pay for their own 548-market pull.
 *
 * At 50k users that was 50k GraphQL queries against an indexer that already
 * times out under a single client. It would have fallen over somewhere around
 * 20-50 concurrent users.
 *
 * With these TTLs the same 50k users cost roughly:
 *
 *   registry   6 pulls/min   (10s TTL)
 *   oracle    12 pulls/min   (5s TTL)
 *   book      20 pulls/min   (3s TTL)
 *
 * — a ~4 order of magnitude reduction in upstream load, and every user after
 * the first gets a cache hit instead of a 2-second wait.
 *
 * TTLs are chosen against how fast the underlying data can actually change:
 * windows are minutes long, so a 10s-stale registry is still correct. The
 * ORDER BOOK is the volatile one and gets the shortest life. Countdowns tick
 * client-side from a server timestamp, so staleness never shows as a frozen
 * clock.
 *
 * What is deliberately NOT cached: anything that signs, and anything
 * per-wallet. Balances, claimable holdings and execution results are read
 * fresh every time — a stale balance is a wrong trade.
 */

import { unstable_cache } from "next/cache";
import { getMarketSnapshot, type MarketSnapshot } from "./markets";
import { getPriceSnapshot, type PriceSnapshot, type Timeframe } from "./prices";
import type { Asset } from "./types";

/** Windows are minutes long; a 10s-stale registry is still correct. */
const REGISTRY_TTL = 10;
/** The oracle publishes per block. */
const ORACLE_TTL = 5;

/**
 * Shared market registry.
 *
 * Note the snapshot carries `fetchedAt`, and every countdown in the UI ticks
 * from that timestamp client-side. So a cached snapshot shows a *correct*
 * countdown, not a frozen one — the staleness is in the row set, not the clock.
 */
export const cachedMarketSnapshot = unstable_cache(
  async (): Promise<MarketSnapshot> => getMarketSnapshot(),
  ["prism:market-snapshot"],
  { revalidate: REGISTRY_TTL, tags: ["markets"] },
);

/** Oracle price + candles, per asset and timeframe. */
export const cachedPriceSnapshot = unstable_cache(
  async (asset: Asset, tf: Timeframe, limit: number): Promise<PriceSnapshot> =>
    getPriceSnapshot(asset, tf, limit),
  ["prism:price-snapshot"],
  { revalidate: ORACLE_TTL, tags: ["prices"] },
);

/**
 * Read-through wrapper that degrades instead of failing.
 *
 * The testnet indexer times out regularly. Without this a single upstream
 * hiccup renders an error page for every user who arrives during it; with it
 * they get the last good snapshot and a stale marker. Correctness is preserved
 * because the caller can see `fetchedAt` and decide.
 */
let lastGood: MarketSnapshot | null = null;

export async function marketSnapshotResilient(): Promise<{
  snapshot: MarketSnapshot | null;
  stale: boolean;
  error: string | null;
}> {
  try {
    const snapshot = await cachedMarketSnapshot();
    lastGood = snapshot;
    return { snapshot, stale: false, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 160) : String(e);
    // Serving the last good registry beats serving an error page, but the
    // caller is told it is stale so it can never be passed off as live.
    if (lastGood) return { snapshot: lastGood, stale: true, error };
    return { snapshot: null, stale: false, error };
  }
}
