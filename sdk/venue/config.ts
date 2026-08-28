/**
 * Venue configuration — every value here was verified against the live Shannon
 * deployment on 2026-08-25, not copied from a doc.
 *
 * The one that costs people hours: the INDEXER url is not the RPC url. The SDK
 * takes both, and passing the RPC where the indexer belongs fails with
 * "RegistryMarkets failed: empty response (no data)", which reads like an
 * outage rather than a config mistake.
 */

export type Network = "testnet" | "mainnet";

interface Endpoints {
  chainId: number;
  rpc: string;
  wsRpc: string;
  /** GraphQL indexer. Distinct host from the RPC — see the note above. */
  indexer: string;
  explorer: string;
}

/** Source: dreamdex-bot-kit packages/ec-core/src/config.ts, confirmed live. */
const ENDPOINTS: Record<Network, Endpoints> = {
  testnet: {
    chainId: 50312,
    rpc: "https://api.infra.testnet.somnia.network",
    wsRpc: "wss://api.infra.testnet.somnia.network/ws",
    indexer: "https://dev.smk.somnia.host/v1/graphql",
    explorer: "https://shannon-explorer.somnia.network",
  },
  mainnet: {
    chainId: 5031,
    rpc: "https://api.infra.mainnet.somnia.network",
    wsRpc: "wss://api.infra.mainnet.somnia.network/ws",
    indexer: "https://prd.smk.somnia.host/v1/graphql",
    explorer: "https://explorer.somnia.network",
  },
};

/**
 * Strike scaling.
 *
 * Market rows carry `strike` as an integer string. The market's own question
 * text pins the scale beyond doubt: strike "247368" on a market asking
 * "...at or above 2473.68..." is two implied decimals. Derived from the venue's
 * own words rather than inferred from a plausible-looking price.
 */
export const STRIKE_DECIMALS = 2;
export const STRIKE_SCALE = 10 ** STRIKE_DECIMALS;

/**
 * Collateral. VERIFIED: tUSDC at SIX decimals, not USDso at eighteen.
 *
 * This matters more than it looks. The bot-kit's loudest gotcha — never hand a
 * float probability to an 18-decimal venue, because parseUnits(0.05.toFixed(18))
 * lands three wei off the tick grid — is an 18-decimal failure. The doc says so
 * itself: "A 6-decimal venue never shows this, so testnet looks clean." We
 * still quantise in integer tick units, because mainnet may not be 6.
 */
export const COLLATERAL = {
  symbol: "tUSDC",
  address: "0x70a86d8842fb63c4ad2b7cdddf530ebf1bb25d8e",
  decimals: 6,
} as const;

/**
 * Venue scoping.
 *
 * VERIFIED: active binary markets span MORE THAN ONE venue id on testnet, and
 * the count moves — two when this was written, four when last read. Pinning the
 * single id published in the bot-kit README silently hides most of the live
 * book. The bot-kit itself warns these "moved three times in the first week of
 * August" and says to read the venueId off a live row instead.
 *
 * So the default is to accept every venue and report which ones we saw, rather
 * than filter to a constant that rots. Deliberately no number is stated here:
 * the count is a live fact, and `MarketSnapshot.venues` is the only place it
 * should ever be read from.
 */
/**
 * LABELS FOR IDS WE HAVE SEEN. NOT A LIST OF THE IDS THAT EXIST.
 *
 * This block used to say active markets span "TWO venue ids", dated 2026-08-25.
 * The live registry now returns FOUR. Nothing broke, because the default is
 * unfiltered — but the comment had quietly become false, which is the same
 * failure the `INTERVALS` constant caused and the reason that one now carries
 * this warning too.
 *
 * The authority on which venues exist is `MarketSnapshot.venues`, counted off
 * the registry on every pull. These two entries survive only to put a readable
 * name on the ids that have documentation behind them; an id absent from here
 * is not unknown to PRISM, merely unlabelled. Never iterate this to enumerate
 * venues, and never filter on it.
 */
export const KNOWN_VENUE_IDS = {
  /** Published in the bot-kit README. */
  primary: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  /** Undocumented; observed carrying struck markets. */
  pricefeed: "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
} as const;

/** A readable name for a venue id, or a truncation when we have none. */
export const venueLabel = (id: string): string => {
  const hit = Object.entries(KNOWN_VENUE_IDS).find(
    ([, v]) => v.toLowerCase() === id.toLowerCase(),
  );
  return hit ? hit[0] : `${id.slice(0, 10)}…${id.slice(-6)}`;
};

/** On-chain MarketStatus enum. Only Trading accepts orders. */
export const MARKET_STATUS = {
  Listed: 0,
  Trading: 1,
  Locked: 2,
  Settling: 3,
  Resolved: 4,
  Voided: 5,
} as const;

export type MarketStatusName = keyof typeof MARKET_STATUS;

/**
 * Cadences with sustained active listings — a DISPLAY fallback, never a filter.
 *
 * VERIFIED 2026-08-27: the live board is not a clean table. Alongside these it
 * carries 51 markets at 60s and a tail of one-off windows — 6s, 45s, 47s, 52s,
 * 56s, 59s, 89s, 92s, 176s, 540s, 542s, 898s, 899s, 3163s, 3164s. Iterating
 * this constant to enumerate the board therefore HIDES real markets, which is
 * exactly what /structures did to every 1m succession chain.
 *
 * So anything enumerating cadences must read them off the snapshot instead.
 * This list survives only to label a known interval nicely.
 */
export const INTERVALS = [
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
  { sec: 900, label: "15m" },
  { sec: 3600, label: "1h" },
  { sec: 14400, label: "4h" },
  { sec: 86400, label: "24h" },
] as const;

export type IntervalLabel = (typeof INTERVALS)[number]["label"];

export const intervalLabel = (sec: number): string =>
  INTERVALS.find((i) => i.sec === sec)?.label ?? `${sec}s`;

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

export interface VenueConfig extends Endpoints {
  network: Network;
  /** Undefined means accept every venue, which is the correct default here. */
  venueId?: string;
  /** When true, nothing is ever signed or sent. */
  dryRun: boolean;
}

/**
 * Resolve config from the environment, falling back to verified defaults.
 * Pure and side-effect free so it is trivially testable.
 */
export function resolveVenueConfig(
  source: Record<string, string | undefined> = process.env,
): VenueConfig {
  const pick = (k: string) => {
    const v = source[k];
    return v && v.trim() !== "" ? v.trim() : undefined;
  };

  const network: Network = pick("PRISM_NETWORK") === "mainnet" ? "mainnet" : "testnet";
  const ep = ENDPOINTS[network];

  return {
    network,
    chainId: ep.chainId,
    rpc: pick("PRISM_RPC_URL") ?? ep.rpc,
    wsRpc: pick("PRISM_WS_RPC_URL") ?? ep.wsRpc,
    indexer: pick("PRISM_INDEXER_URL") ?? ep.indexer,
    explorer: ep.explorer,
    venueId: pick("PRISM_VENUE_ID"),
    // Fail safe: only an explicit "false" disarms the guard.
    dryRun: pick("PRISM_DRY_RUN") !== "false",
  };
}

/** Convenience for display code that must not import the SDK. */
export const VENUE_CONFIG = resolveVenueConfig();

export { env };

/**
 * Venue identity for display.
 *
 * Lived in lib/data.ts beside the fixture generators; the constants were always
 * real, the file around them was not. Moved here so nothing imports a module
 * whose other exports were invented.
 */
export const NETWORK = {
  name: "Somnia",
  chainName: "Shannon Testnet",
  chainId: 50312,
  rpc: "https://api.infra.testnet.somnia.network",
  indexer: "https://dev.smk.somnia.host/v1/graphql",
  collateral: COLLATERAL.symbol,
  /**
   * The documented venue id — a LABEL for display, never the set of venues.
   * Anything that needs to know which venues are live reads
   * `MarketSnapshot.venues`, which is counted off the registry per pull.
   */
  venueId: KNOWN_VENUE_IDS.primary,
} as const;
