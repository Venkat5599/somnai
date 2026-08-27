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
import {
  STRIKE_SCALE,
  intervalLabel,
  resolveVenueConfig,
  type VenueConfig,
} from "./config";
import type { Asset, EventMarket, TermPoint } from "./types";
import { isRoutable } from "./types";

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
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

const isAsset = (v: unknown): v is Asset => v === "BTC" || v === "ETH";

/**
 * Strike comes off the row as an integer string in scaled units.
 *
 * A strike of exactly 0 is NOT a price — it is the venue's way of saying the
 * window has not been struck yet, which was true of eight of the ten live
 * markets at time of writing. Returning null keeps that distinguishable from a
 * genuine zero and forces callers to handle it.
 */
function parseStrike(raw: unknown): number | null {
  const scaled = num(raw, 0);
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  return scaled / STRIKE_SCALE;
}

/** Narrow one SDK row into the PRISM domain type, or null if it isn't usable. */
export function normalizeMarket(m: unknown): EventMarket | null {
  const row = m as Record<string, unknown>;
  if (!row || row.type !== "binary") return null;

  const info = (row.info ?? {}) as Record<string, unknown>;
  const marketId = str(info.marketId) ?? str(row.id);
  if (!marketId) return null;

  const asset = info.asset;
  if (!isAsset(asset)) return null;

  const intervalSec = num(info.intervalSec, 0);
  if (intervalSec <= 0) return null;

  const precision = (row.precision ?? {}) as Record<string, unknown>;
  const limits = (row.limits ?? {}) as Record<string, unknown>;
  const amountLimit = (limits.amount ?? {}) as Record<string, unknown>;

  return {
    marketId,
    symbol: str(row.symbol) ?? marketId,
    asset,
    strike: parseStrike(info.strike),

    intervalSec,
    interval: str(info.interval) ?? intervalLabel(intervalSec),

    tradingStart: num(info.tradingStart, 0),
    expiry: num(info.expiry, 0),

    status: str(info.status) ?? "Unknown",
    active: row.active === true,
    finalized: info.finalized === true,
    voided: info.voided === true,

    venueId: str(info.venueId),
    operatorId: typeof info.operatorId === "number" ? info.operatorId : null,

    poolAddress: str(info.poolAddress),
    nonce: info.nonce != null ? num(info.nonce, 0) : null,
    marketAddress: str(info.marketAddress),

    yesTokenId: str(info.yesTokenId),
    noTokenId: str(info.noTokenId),

    question: str(info.question),
    collateral: str(info.collateral),
    quoteDecimals: num(info.quoteDecimals, 6),

    pricePrecision: num(precision.price, 3),
    amountPrecision: num(precision.amount, 3),
    minAmount: num(amountLimit.min, 0.001),

    tradeCount: num(info.tradeCount, 0),
    quoteVolume: num(info.cumulativeQuoteVolume, 0),

    winningOutcome:
      info.winningOutcome != null ? num(info.winningOutcome, 0) : null,
  };
}

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
  fetchedAt: number;
  network: string;
}

/**
 * Pull the registry and normalise it.
 *
 * Venue filtering is applied only when explicitly configured. The default is
 * deliberately unfiltered: active markets were verified to span TWO venue ids
 * on testnet, so pinning the one published in the bot-kit README silently hides
 * half the live book.
 */
export async function getMarketSnapshot(
  config: VenueConfig = resolveVenueConfig(),
): Promise<MarketSnapshot> {
  const ex = exchange(config);
  const raw = Object.values(await ex.loadMarkets(true));

  let all = raw
    .map(normalizeMarket)
    .filter((m): m is EventMarket => m !== null);

  if (config.venueId) {
    const want = config.venueId.toLowerCase();
    all = all.filter((m) => (m.venueId ?? "").toLowerCase() === want);
  }

  const venues: Record<string, number> = {};
  for (const m of all) {
    const v = m.venueId ?? "unknown";
    venues[v] = (venues[v] ?? 0) + 1;
  }

  const now = Date.now();
  const active = all.filter((m) => m.active);

  return {
    all,
    active,
    routable: active.filter((m) => isRoutable(m, now)),
    venues,
    fetchedAt: now,
    network: config.network,
  };
}

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
