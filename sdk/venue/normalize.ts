/**
 * Registry row -> `EventMarket`, and the reason when it cannot be.
 *
 * DELIBERATELY NOT `server-only`, for the same reason as `grid.ts` and
 * `atomicity.ts`: this is pure narrowing with no SDK, no network and no key,
 * and it is the part that most needs testing. `server-only` throws the moment
 * vitest imports it, so leaving this inside `markets.ts` meant the function
 * that decides WHICH MARKETS EXIST was the one function that could not be
 * tested — and it was silently discarding every underlying outside BTC/ETH.
 */

import { STRIKE_SCALE, intervalLabel } from "./config";
import type { Asset, EventMarket } from "./types";

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

/**
 * Any non-empty string the venue puts in `asset` is an underlying.
 *
 * This used to be `v === "BTC" || v === "ETH"`, which made a hand-written list
 * into a filter on what PRISM could see: a third underlying would have been
 * dropped by the line below with no counter and no log. The venue owns this
 * value, so the only thing to check is that it is present and usable.
 */
const isAsset = (v: unknown): v is Asset => typeof v === "string" && v.trim() !== "";

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

/**
 * Why a registry row did not become an `EventMarket`.
 *
 * Discarding used to be silent — `normalizeMarket` returned `null` and the
 * caller filtered it out, so a row PRISM could not read left no trace anywhere.
 * That is how the `INTERVALS` bug hid every 1m succession chain for days: the
 * loss had no counter, so nothing could show it.
 *
 * Every rejection now names itself, and `getMarketSnapshot` tallies them.
 */
export type DropReason =
  | "NOT_BINARY"
  | "NO_MARKET_ID"
  | "NO_ASSET"
  | "NO_INTERVAL";

export type RowVerdict =
  | { ok: true; market: EventMarket }
  | { ok: false; reason: DropReason };

/**
 * Narrow one SDK row into the PRISM domain type, or say why it could not be.
 *
 * The reason is the point. `normalizeMarket` below is the convenience wrapper
 * for callers that genuinely only want the row or nothing.
 */
export function classifyRow(m: unknown): RowVerdict {
  const row = m as Record<string, unknown>;
  if (!row || row.type !== "binary") return { ok: false, reason: "NOT_BINARY" };

  const info = (row.info ?? {}) as Record<string, unknown>;
  const marketId = str(info.marketId) ?? str(row.id);
  if (!marketId) return { ok: false, reason: "NO_MARKET_ID" };

  const asset = info.asset;
  if (!isAsset(asset)) return { ok: false, reason: "NO_ASSET" };

  const intervalSec = num(info.intervalSec, 0);
  if (intervalSec <= 0) return { ok: false, reason: "NO_INTERVAL" };

  const precision = (row.precision ?? {}) as Record<string, unknown>;
  const limits = (row.limits ?? {}) as Record<string, unknown>;
  const amountLimit = (limits.amount ?? {}) as Record<string, unknown>;

  const market: EventMarket = {
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

  return { ok: true, market };
}

/** Narrow one SDK row, or null if it isn't usable. Reason-free convenience. */
export function normalizeMarket(m: unknown): EventMarket | null {
  const v = classifyRow(m);
  return v.ok ? v.market : null;
}

