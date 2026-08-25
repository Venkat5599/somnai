/**
 * Venue-shaped fixtures.
 *
 * Field names mirror `@somnia-chain/markets-sdk` (marketType BINARY, venueId,
 * asset, strike, intervalSec, status) so swapping these for `listBinaryMarkets`
 * on Shannon testnet is a transport change, not a refactor.
 */

import type { LadderRung } from "./quant";

export const NETWORK = {
  name: "Somnia",
  chainName: "Shannon Testnet",
  chainId: 50312,
  rpc: "https://dream-rpc.somnia.network",
  rest: "https://stg.api.dreamdex.io/v0",
  ws: "wss://stg.api.dreamdex.io/v0/ws/public",
  collateral: "USDso",
  venueId:
    "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
} as const;

/** On-chain MarketStatus enum. Only status 1 accepts orders. */
export const MARKET_STATUS = [
  "Listed",
  "Trading",
  "Locked",
  "Settling",
  "Resolved",
  "Voided",
] as const;
export type MarketStatus = (typeof MARKET_STATUS)[number];

export interface BinaryMarket {
  marketId: string;
  asset: "BTC" | "ETH";
  symbol: string;
  strike: number;
  intervalSec: number;
  expiresAt: string;
  up: number;
  down: number;
  vol24h: number;
  /** Resting depth within 2% of mid, in contracts. */
  depth: number;
  status: MarketStatus;
}

export const SPOT: Record<"BTC" | "ETH", { price: number; change: number; vol: number }> = {
  BTC: { price: 109842.32, change: 0.024, vol: 4_200_000_000 },
  ETH: { price: 4128.5, change: -0.008, vol: 1_940_000_000 },
};

const EXPIRIES = [
  { label: "5m", intervalSec: 300 },
  { label: "15m", intervalSec: 900 },
  { label: "1h", intervalSec: 3600 },
  { label: "4h", intervalSec: 14400 },
  { label: "1d", intervalSec: 86400 },
] as const;

export type ExpiryLabel = (typeof EXPIRIES)[number]["label"];
export const EXPIRY_OPTIONS = EXPIRIES;

/** Deterministic pseudo-noise so server and client render identical numbers. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

const BASE_VOL: Record<ExpiryLabel, number> = {
  "5m": 0.412,
  "15m": 0.368,
  "1h": 0.312,
  "4h": 0.281,
  "1d": 0.248,
};

import { digitalUp } from "./quant";

/** Round up to the nearest 1, 2 or 5 times a power of ten. */
function niceStep(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / mag;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * mag;
}

/**
 * Strike ladders are generated per window, not fixed.
 *
 * A real venue lists strikes around the money at a spacing that matches the
 * window: a 5m market's rungs sit far tighter than a 1d market's, because the
 * distribution of outcomes over five minutes is far narrower. A single fixed
 * ladder across every expiry would make every short-window market read as a
 * step function of ones and zeros, which is exactly the wrong picture.
 */
export function strikesFor(asset: "BTC" | "ETH", expiry: ExpiryLabel): number[] {
  const spot = SPOT[asset].price;
  const interval = EXPIRIES.find((e) => e.label === expiry)!.intervalSec;
  const years = interval / (365 * 24 * 3600);
  const sd = spot * BASE_VOL[expiry] * Math.sqrt(years);
  const step = niceStep(sd * 0.62);
  const centre = Math.round(spot / step) * step;
  const out: number[] = [];
  for (let i = -5; i <= 5; i++) {
    const k = centre + i * step;
    if (k > 0) out.push(Number(k.toFixed(6)));
  }
  return out;
}

function buildMarkets(): BinaryMarket[] {
  const out: BinaryMarket[] = [];
  let seed = 1;
  for (const asset of ["BTC", "ETH"] as const) {
    const spot = SPOT[asset].price;
    for (const exp of EXPIRIES) {
      const years = exp.intervalSec / (365 * 24 * 3600);
      const strikes = strikesFor(asset, exp.label);
      for (const strike of strikes) {
        seed += 1;
        const years0 = years;
        const sd = BASE_VOL[exp.label] * Math.sqrt(years0);
        // Standardised moneyness: how many standard deviations out the strike
        // sits. The smile has to be written in these units or it vanishes on
        // short windows and explodes on long ones.
        const z = Math.log(strike / spot) / (sd || 1e-9);
        const vol = BASE_VOL[exp.label] * (1 + 0.055 * z * z - 0.032 * z);
        const fair = digitalUp(spot, strike, vol, years);
        const up = Math.min(0.985, Math.max(0.015, fair + jitter(seed) * 0.012));
        out.push({
          marketId: `${asset}-${strike}-${exp.intervalSec}`,
          asset,
          symbol: `${asset}/USD`,
          strike,
          intervalSec: exp.intervalSec,
          expiresAt: exp.label,
          up: Number(up.toFixed(4)),
          down: Number((1 - up).toFixed(4)),
          vol24h: Math.round(
            (asset === "BTC" ? 14_000_000 : 8_400_000) *
              (1 + jitter(seed * 3)) *
              (1 / Math.sqrt(exp.intervalSec / 300)),
          ),
          // Depth is deepest at the money and thins out into the wings, which
          // is what forces the router to be depth aware rather than mid aware.
          depth: Math.max(
            40,
            Math.round(
              (asset === "BTC" ? 2_400 : 1_500) *
                (1 + jitter(seed * 7) * 0.5) *
                Math.exp(-0.28 * z * z),
            ),
          ),
          status: "Trading",
        });
      }
    }
  }
  return out;
}

export const MARKETS: BinaryMarket[] = buildMarkets();

export function ladderFor(asset: "BTC" | "ETH", expiry: ExpiryLabel): LadderRung[] {
  const interval = EXPIRIES.find((e) => e.label === expiry)!.intervalSec;
  return MARKETS.filter((m) => m.asset === asset && m.intervalSec === interval)
    .sort((a, b) => a.strike - b.strike)
    .map((m) => ({ strike: m.strike, up: m.up }));
}

export function depthMapFor(
  asset: "BTC" | "ETH",
  expiry: ExpiryLabel,
): Record<number, number> {
  const interval = EXPIRIES.find((e) => e.label === expiry)!.intervalSec;
  return Object.fromEntries(
    MARKETS.filter((m) => m.asset === asset && m.intervalSec === interval).map(
      (m) => [m.strike, m.depth],
    ),
  );
}

export function volFor(asset: "BTC" | "ETH", expiry: ExpiryLabel) {
  return BASE_VOL[expiry] * (asset === "ETH" ? 1.12 : 1);
}

/* ------------------------------------------------------------------ */

export interface StructurePreset {
  id: string;
  name: string;
  subtitle: string;
  kind: "DIRECTIONAL" | "RANGE" | "SPREAD" | "LADDER" | "CALENDAR";
  risk: "Low" | "Medium" | "High";
  legs: number;
  blurb: string;
  asset: "BTC" | "ETH";
  expiry: ExpiryLabel;
  lower: number;
  upper: number;
}

/** Strike `n` rungs away from the money on a given ladder. */
export function strikeAt(
  asset: "BTC" | "ETH",
  expiry: ExpiryLabel,
  offset: number,
): number {
  const ks = strikesFor(asset, expiry);
  const spot = SPOT[asset].price;
  const atm = ks.reduce((b, k) =>
    Math.abs(k - spot) < Math.abs(b - spot) ? k : b,
  );
  const i = ks.indexOf(atm);
  return ks[Math.min(Math.max(i + offset, 0), ks.length - 1)];
}

const label = (a: "BTC" | "ETH", k: number) =>
  a === "BTC"
    ? `${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}K`
    : k.toLocaleString("en-US");

function preset(
  base: Omit<StructurePreset, "lower" | "upper" | "subtitle"> & {
    loOff: number;
    hiOff: number;
  },
): StructurePreset {
  const lower = strikeAt(base.asset, base.expiry, base.loOff);
  const upper = strikeAt(base.asset, base.expiry, base.hiOff);
  const subtitle =
    lower === upper
      ? `${base.asset} ${label(base.asset, lower)} · ${base.expiry}`
      : `${base.asset} ${label(base.asset, lower)} to ${label(base.asset, upper)} · ${base.expiry}`;
  const { loOff: _lo, hiOff: _hi, ...rest } = base;
  return { ...rest, lower, upper, subtitle };
}

export const PRESETS: StructurePreset[] = [
  preset({
    id: "btc-range",
    name: "Range",
    kind: "RANGE",
    risk: "Low",
    legs: 2,
    blurb:
      "Long the Up at the lower strike, short the Up at the upper. The pair nets to one contract inside the band and zero outside it.",
    asset: "BTC",
    expiry: "4h",
    loOff: -2,
    hiOff: 2,
  }),
  preset({
    id: "btc-spread",
    name: "Digital Spread",
    kind: "SPREAD",
    risk: "Medium",
    legs: 2,
    blurb:
      "A financed directional view. Selling the far strike pays for part of the near one, capping the payout in exchange for a lower entry.",
    asset: "BTC",
    expiry: "4h",
    loOff: 0,
    hiOff: 3,
  }),
  preset({
    id: "eth-ladder",
    name: "Volatility Ladder",
    kind: "LADDER",
    risk: "High",
    legs: 5,
    blurb:
      "Notional spread evenly across every rung in the band, so no single thin book absorbs the whole order and slippage stays bounded.",
    asset: "ETH",
    expiry: "1h",
    loOff: -2,
    hiOff: 2,
  }),
  preset({
    id: "btc-calendar",
    name: "Calendar",
    kind: "CALENDAR",
    risk: "Low",
    legs: 2,
    blurb:
      "Holds one strike across window succession. The Roll Engine re-strikes into each successor so a five minute market becomes a real tenor.",
    asset: "BTC",
    expiry: "1h",
    loOff: 0,
    hiOff: 0,
  }),
];

/* ------------------------------------------------------------------ */

export interface Position {
  id: string;
  name: string;
  asset: string;
  strategy: string;
  notional: number;
  entry: number;
  current: number;
  pnl: number;
  status: "Active" | "Rolling" | "Settling";
  legs: number;
  expiresIn: string;
}

export const POSITIONS: Position[] = [
  {
    id: "PS-4471",
    name: "BTC Range 108/112",
    asset: "BTC/USD",
    strategy: "Range",
    notional: 12000,
    entry: 108420.0,
    current: 109842.32,
    pnl: 450.0,
    status: "Active",
    legs: 2,
    expiresIn: "02:14:08",
  },
  {
    id: "PS-4468",
    name: "ETH Ladder 4.0K",
    asset: "ETH/USD",
    strategy: "Ladder",
    notional: 4500,
    entry: 4062.5,
    current: 4128.5,
    pnl: 182.4,
    status: "Active",
    legs: 5,
    expiresIn: "00:41:22",
  },
  {
    id: "PS-4459",
    name: "BTC Calendar 110K",
    asset: "BTC/USD",
    strategy: "Calendar",
    notional: 8200,
    entry: 109210.0,
    current: 109842.32,
    pnl: -45.5,
    status: "Rolling",
    legs: 2,
    expiresIn: "00:00:42",
  },
  {
    id: "PS-4442",
    name: "ETH Spread 4.1/4.2K",
    asset: "ETH/USD",
    strategy: "Spread",
    notional: 1500,
    entry: 4104.1,
    current: 4128.5,
    pnl: 112.0,
    status: "Active",
    legs: 2,
    expiresIn: "05:12:55",
  },
  {
    id: "PS-4430",
    name: "BTC Directional 109K",
    asset: "BTC/USD",
    strategy: "Directional",
    notional: 850,
    entry: 109010.0,
    current: 109842.32,
    pnl: 28.0,
    status: "Settling",
    legs: 1,
    expiresIn: "00:00:00",
  },
];

/* ------------------------------------------------------------------ */

export interface ActivityRow {
  time: string;
  action: "Structure Created" | "Auto Roll" | "Settlement" | "Claim" | "Cancel";
  structure: string;
  ref: string;
  market: string;
  amount: string;
  status: "Confirmed" | "Completed" | "Pending" | "Failed";
  tx: string;
}

export const ACTIVITY: ActivityRow[] = [
  {
    time: "14:35:10.004",
    action: "Structure Created",
    structure: "BTC Range 108/112",
    ref: "PS-4471",
    market: "BTC/USD",
    amount: "12,000 USDso",
    status: "Pending",
    tx: "0x7e11...c4a2",
  },
  {
    time: "14:32:45.102",
    action: "Structure Created",
    structure: "ETH Ladder 4.0K",
    ref: "PS-4468",
    market: "ETH/USD",
    amount: "4,500 USDso",
    status: "Confirmed",
    tx: "0x8f2a...9b4c",
  },
  {
    time: "14:28:12.045",
    action: "Auto Roll",
    structure: "BTC Calendar 110K",
    ref: "PS-4459",
    market: "BTC/USD",
    amount: "8,200 USDso",
    status: "Completed",
    tx: "0x3d1e...7a2f",
  },
  {
    time: "14:15:00.882",
    action: "Settlement",
    structure: "BTC Directional 109K",
    ref: "PS-4430",
    market: "BTC/USD",
    amount: "850 USDso",
    status: "Completed",
    tx: "0x9c4b...1e8d",
  },
  {
    time: "14:02:31.410",
    action: "Claim",
    structure: "ETH Range 4.0/4.2K",
    ref: "PS-4401",
    market: "ETH/USD",
    amount: "1,472 USDso",
    status: "Completed",
    tx: "0x2a77...ff10",
  },
  {
    time: "13:58:04.229",
    action: "Cancel",
    structure: "BTC Spread 111/113",
    ref: "PS-4398",
    market: "BTC/USD",
    amount: "3,100 USDso",
    status: "Confirmed",
    tx: "0x5b90...30de",
  },
  {
    time: "13:44:19.771",
    action: "Auto Roll",
    structure: "ETH Calendar 4.1K",
    ref: "PS-4372",
    market: "ETH/USD",
    amount: "2,400 USDso",
    status: "Failed",
    tx: "0x1cc4...88a5",
  },
];

/* ------------------------------------------------------------------ */

export interface SettlementLeg {
  label: string;
  side: "UP" | "DOWN";
  strike: number;
  result: "ITM" | "OTM";
  value: number;
}

export interface SettlementRow {
  id: string;
  name: string;
  contract: string;
  expiredAt: string;
  status: "Finalized" | "Settling";
  cost: number;
  gross: number;
  legs: SettlementLeg[];
}

export const SETTLEMENTS: SettlementRow[] = [
  {
    id: "PS-4401",
    name: "BTC Range 108K to 112K",
    contract: "0x8F9c...2A1C",
    expiredAt: "2026-08-24 08:00 UTC",
    status: "Finalized",
    cost: 100.0,
    gross: 147.32,
    legs: [
      { label: "Long Up", side: "UP", strike: 108000, result: "ITM", value: 100 },
      { label: "Short Up", side: "UP", strike: 112000, result: "OTM", value: 0 },
    ],
  },
  {
    id: "PS-4388",
    name: "ETH Ladder 4.0K to 4.2K",
    contract: "0x41b2...9DE0",
    expiredAt: "2026-08-24 07:00 UTC",
    status: "Finalized",
    cost: 420.0,
    gross: 388.4,
    legs: [
      { label: "Long Up", side: "UP", strike: 4000, result: "ITM", value: 140 },
      { label: "Long Up", side: "UP", strike: 4100, result: "ITM", value: 140 },
      { label: "Long Up", side: "UP", strike: 4200, result: "OTM", value: 0 },
    ],
  },
  {
    id: "PS-4370",
    name: "BTC Directional 109K",
    contract: "0x0d3a...771B",
    expiredAt: "2026-08-24 06:00 UTC",
    status: "Settling",
    cost: 62.5,
    gross: 0,
    legs: [{ label: "Long Up", side: "UP", strike: 109000, result: "ITM", value: 0 }],
  },
];

/* ------------------------------------------------------------------ */

export interface RollJob {
  id: string;
  asset: string;
  from: string;
  to: string;
  size: string;
  progress: number;
  status: "Rolling" | "Queued" | "Armed";
  nextIn: number;
}

export const ROLL_QUEUE: RollJob[] = [
  {
    id: "RE-774A",
    asset: "BTC/USD",
    from: "5m window",
    to: "4h structure",
    size: "12,000 USDso",
    progress: 0.62,
    status: "Rolling",
    nextIn: 42,
  },
  {
    id: "RE-771C",
    asset: "ETH/USD",
    from: "15m window",
    to: "1d structure",
    size: "4,500 USDso",
    progress: 0.18,
    status: "Queued",
    nextIn: 288,
  },
  {
    id: "RE-769F",
    asset: "BTC/USD",
    from: "1h window",
    to: "1d structure",
    size: "8,200 USDso",
    progress: 0,
    status: "Armed",
    nextIn: 1844,
  },
];
