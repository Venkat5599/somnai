import "server-only";

/**
 * The live-venue read path.
 *
 * Everything the app renders about markets comes through here. The SDK returns
 * a wide `UnifiedMarket` covering spot, perp and binary behind optional fields,
 * with every number stringified; this module narrows it once, at the boundary,
 * into `EventMarket` so nothing downstream can do arithmetic on a decimal
 * string or read a field that only exists on spot rows.
 *
 * Server-only on purpose: the SDK opens chain sockets and carries viem, which
 * has no business in a browser bundle.
 */

import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon, somniaMainnet } from "@somnia-chain/markets-sdk/chains";
import { intervalLabel, resolveVenueConfig, type VenueConfig } from "./config";
import type { Asset, EventMarket, TermPoint } from "./types";
import { compareAssets, isRoutable } from "./types";

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

let cached: { key: string; ex: SomniaMarkets } | null = null;

/**
 * One exchange per config. The SDK holds a live store and a lazily-opened
 * socket, so constructing one per request would leak connections.
 */
export function exchange(config: VenueConfig = resolveVenueConfig()): SomniaMarkets {
  const key = `${config.network}|${config.rpc}|${config.indexer}`;
  if (cached?.key === key) return cached.ex;

  // ClientConfig is { indexerUrl, chain, wsRpcUrl? } — there is no `rpcUrl`
  // field. The RPC is read off the chain definition, so overriding it means
  // cloning the chain with new rpcUrls rather than passing a sibling option.
  const base = config.network === "mainnet" ? somniaMainnet : somniaShannon;
  const chain =
    config.rpc && config.rpc !== base.rpcUrls.default.http[0]
      ? {
          ...base,
          rpcUrls: {
            ...base.rpcUrls,
            default: { ...base.rpcUrls.default, http: [config.rpc] as const },
          },
        }
      : base;

  const ex = new SomniaMarkets({
    chain,
    indexerUrl: config.indexer,
    wsRpcUrl: config.wsRpc,
    // The oracle price feed is a separate endpoint from the market indexer.
    // Without it fetchPrice/fetchPriceOHLCV reject rather than returning null,
    // which reads like an outage instead of a missing config line.
    priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  });

  cached = { key, ex };
  return ex;
}

/* ------------------------------------------------------------------ */
/* Normalisation — lives in normalize.ts so vitest can import it        */
/* ------------------------------------------------------------------ */

export {
  classifyRow,
  normalizeMarket,
  type DropReason,
  type RowVerdict,
} from "./normalize";
import { classifyRow } from "./normalize";

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export interface MarketSnapshot {
  /** Every binary market the registry returned, normalised. */
  all: EventMarket[];
  /** Markets the SDK considers live for their window. */
  active: EventMarket[];
  /** Active, Trading, struck, and not inside expiry headroom. */
  routable: EventMarket[];
  /** Distinct venue ids seen on binary rows, with counts. */
  venues: Record<string, number>;
  /**
   * Distinct underlyings seen, with counts.
   *
   * Read off the registry rather than assumed. If DreamDEX lists SOL tomorrow
   * it appears here without a code change — and if PRISM ever stops seeing ETH,
   * that shows here too, which a hard-coded pair could never say.
   */
  assets: Record<string, number>;
  /**
   * Rows the registry returned that PRISM could not read, by reason.
   *
   * Non-binary rows dominate and are expected — the registry carries spot and
   * perp too. The ones that matter are `NO_ASSET` and `NO_INTERVAL`: those are
   * binary markets PRISM is failing to understand, and before this counter
   * existed they vanished without trace.
   */
  dropped: Record<string, number>;
  /** Total rows discarded, across every reason. */
  droppedTotal: number;
  fetchedAt: number;
  network: string;
}

/**
 * Pull the registry and normalise it.
 *
 * Venue filtering is applied only when explicitly configured. The default is
 * deliberately unfiltered: active markets span more than one venue id, and the
 * count moves — pinning the one published in the bot-kit README silently hides
 * most of the live book. `venues` below reports what was actually seen, which
 * is the only place that count should ever be read from.
 */
export async function getMarketSnapshot(
  config: VenueConfig = resolveVenueConfig(),
): Promise<MarketSnapshot> {
  const ex = exchange(config);
  const raw = Object.values(await ex.loadMarkets(true));

  // Classify every row and KEEP the rejections. A row PRISM cannot read is a
  // fact about the venue, not noise to be filtered away silently.
  const dropped: Record<string, number> = {};
  let all: EventMarket[] = [];
  for (const row of raw) {
    const v = classifyRow(row);
    if (v.ok) all.push(v.market);
    else dropped[v.reason] = (dropped[v.reason] ?? 0) + 1;
  }

  if (config.venueId) {
    const want = config.venueId.toLowerCase();
    all = all.filter((m) => (m.venueId ?? "").toLowerCase() === want);
  }

  const venues: Record<string, number> = {};
  const assets: Record<string, number> = {};
  for (const m of all) {
    const v = m.venueId ?? "unknown";
    venues[v] = (venues[v] ?? 0) + 1;
    assets[m.asset] = (assets[m.asset] ?? 0) + 1;
  }

  const now = Date.now();
  const active = all.filter((m) => m.active);

  return {
    all,
    active,
    routable: active.filter((m) => isRoutable(m, now)),
    venues,
    assets,
    dropped,
    droppedTotal: Object.values(dropped).reduce((a, b) => a + b, 0),
    fetchedAt: now,
    network: config.network,
  };
}

/** Underlyings the registry actually carried, known ones first. */
export const assetsInSnapshot = (snap: MarketSnapshot): Asset[] =>
  Object.keys(snap.assets).sort(compareAssets);

/** Active markets for one asset, ascending by window length. */
export const marketsForAsset = (snap: MarketSnapshot, asset: Asset): EventMarket[] =>
  snap.active
    .filter((m) => m.asset === asset)
    .sort((a, b) => a.intervalSec - b.intervalSec);

/**
 * The term structure for an asset.
 *
 * This is PRISM's real axis. The venue lists one strike per window, so there is
 * no strike ladder to differentiate across — but there ARE five cadences, and
 * a single strike observed across them is a genuine term structure. Composition
 * happens along time here, not along strike.
 */
export function termStructure(
  snap: MarketSnapshot,
  asset: Asset,
  now = Date.now(),
): TermPoint[] {
  const YEAR = 365 * 24 * 3600;
  return marketsForAsset(snap, asset)
    .filter((m): m is EventMarket & { strike: number } => m.strike !== null)
    .map((m) => ({
      asset,
      intervalSec: m.intervalSec,
      interval: m.interval,
      strike: m.strike,
      years: Math.max(m.expiry - Math.floor(now / 1000), 0) / YEAR,
      marketId: m.marketId,
    }))
    .sort((a, b) => a.intervalSec - b.intervalSec);
}

/**
 * The succession chain for a strike: the markets a position would roll through.
 * Same asset and cadence, ordered by expiry — which is exactly what the Roll
 * Engine carries a thesis across.
 */
export function successionChain(
  snap: MarketSnapshot,
  asset: Asset,
  intervalSec: number,
): EventMarket[] {
  // Match on the venue's OWN label for the series, not on the raw second count.
  //
  // VERIFIED 2026-08-27: the venue lists BTC and ETH "15m" windows at 898, 899
  // AND 900 seconds. An exact `intervalSec ===` match splits one series into
  // three chains, so a position on the 900s window cannot see a successor
  // listed at 899s and the roll reports NO_SUCCESSOR_LISTED on a successor that
  // is right there. The venue calling them all "15m" is the venue saying they
  // are one series; that is the authority, not the drifted integer.
  //
  // This was not the cause of the successors missing today — a label match
  // finds none either — but it is a live trap the moment one appears.
  const series = snap.all.find(
    (m) => m.asset === asset && m.intervalSec === intervalSec,
  );
  const label = series?.interval ?? intervalLabel(intervalSec);

  return snap.all
    .filter(
      (m) =>
        m.asset === asset &&
        (m.interval === label || m.intervalSec === intervalSec),
    )
    .sort((a, b) => a.expiry - b.expiry);
}
