import "server-only";

/**
 * The Somnia oracle price feed.
 *
 * This is the UNDERLYING BTC/ETH price the Event Contracts settle against — a
 * separate endpoint from the market indexer, served by the chain's own EMA
 * oracle. Verified live: BTC 79,126.85 at block 471,101,032.
 *
 * Deliberately NOT a third-party ticker. A chart fed from Binance would look
 * identical and mean nothing: the number that decides whether a contract pays
 * is the one the oracle wrote on-chain, and that is what this reads.
 */

import { exchange } from "./markets";
import { resolveVenueConfig, type VenueConfig } from "./config";
import type { Asset } from "./types";

/** Feed resolutions. The SDK aliases these onto the oracle's M1/H1/D1. */
export const TIMEFRAMES = ["1m", "1h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface Candle {
  /** Unix SECONDS — lightweight-charts wants seconds, the SDK returns ms. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Oracle update count for the bucket. NOT trade volume — the SDK is explicit. */
  updates: number;
}

export interface LivePrice {
  asset: Asset;
  price: number;
  /** The EMA mark the oracle publishes alongside spot. */
  ema: number;
  /** Unix seconds. */
  timestamp: number;
  blockNumber: number | null;
}

/** Current oracle price, or null when the feed has no observation yet. */
export async function getLivePrice(
  asset: Asset,
  config: VenueConfig = resolveVenueConfig(),
): Promise<LivePrice | null> {
  const p = await exchange(config).fetchPrice(asset);
  if (!p) return null;

  const info = (p as { info?: Record<string, unknown> }).info ?? {};
  const blockNumber =
    typeof info.blockNumber === "number" ? info.blockNumber : null;

  return {
    asset,
    price: p.price,
    // `ema` rides on info rather than the unified shape.
    ema: typeof info.ema === "number" ? info.ema : p.price,
    timestamp: Math.floor((p.timestamp ?? Date.now()) / 1000),
    blockNumber,
  };
}

/**
 * OHLC candles, oldest first.
 *
 * The SDK hands back CCXT-style tuples `[ms, o, h, l, c, vol]`. Converting to
 * named fields with seconds here means the chart component never has to know
 * about tuple indices or unit conversion.
 */
export async function getCandles(
  asset: Asset,
  timeframe: Timeframe = "1m",
  limit = 240,
  config: VenueConfig = resolveVenueConfig(),
): Promise<Candle[]> {
  const rows = await exchange(config).fetchPriceOHLCV(
    asset,
    timeframe,
    undefined,
    limit,
  );

  return (rows ?? [])
    .map((r) => {
      const [ms, open, high, low, close, updates] = r as unknown as number[];
      return {
        time: Math.floor(ms / 1000),
        open,
        high,
        low,
        close,
        updates: updates ?? 0,
      };
    })
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.close),
    )
    // Ascending and de-duplicated: lightweight-charts throws on unordered or
    // repeated timestamps rather than rendering something subtly wrong.
    .sort((a, b) => a.time - b.time)
    .filter((c, i, a) => i === 0 || c.time !== a[i - 1].time);
}

export interface PriceSnapshot {
  live: LivePrice | null;
  candles: Candle[];
  timeframe: Timeframe;
  fetchedAt: number;
}

/** Everything a price chart needs, in one server round trip. */
export async function getPriceSnapshot(
  asset: Asset,
  timeframe: Timeframe = "1m",
  limit = 240,
): Promise<PriceSnapshot> {
  const [live, candles] = await Promise.all([
    getLivePrice(asset).catch(() => null),
    getCandles(asset, timeframe, limit).catch(() => [] as Candle[]),
  ]);
  return { live, candles, timeframe, fetchedAt: Date.now() };
}
