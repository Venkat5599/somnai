/**
 * PRISM domain types.
 *
 * These are deliberately NOT the SDK's `UnifiedMarket`. That type is wide,
 * carries both spot and binary shapes behind optional fields, and stringifies
 * every number. Normalising once at the boundary means the rest of the app
 * holds real numbers with known units and cannot accidentally do arithmetic on
 * a decimal string.
 */

export type Asset = "BTC" | "ETH";

/** Which side of the binary. The venue labels these YES/NO, not UP/DOWN. */
export type Outcome = "YES" | "NO";

export interface EventMarket {
  /** bytes32 marketId. THE stable key — never key state by pool address. */
  marketId: string;
  /** Venue-assigned display symbol, e.g. "ETH-247368-25AUG26-1620/tUSDC". */
  symbol: string;
  asset: Asset;

  /**
   * Strike in quote units (already divided by STRIKE_SCALE).
   * `null` when the venue has not struck the window yet — a real state that
   * eight of ten live markets were in at time of writing, not an error.
   */
  strike: number | null;

  /** Window cadence in seconds, and the venue's own label for it. */
  intervalSec: number;
  interval: string;

  /** Unix seconds. */
  tradingStart: number;
  expiry: number;

  status: string;
  /** The SDK's own liveness verdict, derived from the window, not the indexer. */
  active: boolean;
  finalized: boolean;
  voided: boolean;

  /** Venue this market belongs to. Active markets span more than one. */
  venueId: string | null;
  operatorId: number | null;

  /**
   * Pool binding. TIME-VARYING: pools are recycled across successive markets,
   * so (poolAddress, nonce) identifies a slice of a pool's history, never a
   * market on its own.
   */
  poolAddress: string | null;
  nonce: number | null;
  marketAddress: string | null;

  /** ERC-1155 outcome token ids. */
  yesTokenId: string | null;
  noTokenId: string | null;

  /** Venue's human-readable question. Never parse this — read strike/interval. */
  question: string | null;

  collateral: string | null;
  quoteDecimals: number;

  /** Execution grid. */
  pricePrecision: number;
  amountPrecision: number;
  minAmount: number;

  tradeCount: number;
  quoteVolume: number;

  winningOutcome: number | null;
}

/** Seconds until the window closes. Negative once expired. */
export const secondsToExpiry = (m: EventMarket, now = Date.now()): number =>
  m.expiry - Math.floor(now / 1000);

/** A market is routable only if the chain says Trading and the window is open. */
export const isRoutable = (m: EventMarket, now = Date.now()): boolean =>
  m.active &&
  m.status === "Trading" &&
  !m.finalized &&
  !m.voided &&
  m.strike !== null &&
  secondsToExpiry(m, now) > 0;

/**
 * Expiry headroom, scaled to the window rather than fixed.
 *
 * A flat 300s threshold rejects every market on a venue running 5-minute
 * windows — which this venue does. Eight percent of the interval, floored at
 * five seconds.
 */
export const headroomSec = (intervalSec: number): number =>
  Math.max(5, Math.round(intervalSec * 0.08));

/** True when the window is too close to close to safely send an order. */
export const withinHeadroom = (m: EventMarket, now = Date.now()): boolean =>
  secondsToExpiry(m, now) <= headroomSec(m.intervalSec);

/** A term-structure point: one cadence, one strike, one expiry. */
export interface TermPoint {
  asset: Asset;
  intervalSec: number;
  interval: string;
  strike: number;
  /** Years to expiry. */
  years: number;
  marketId: string;
}
