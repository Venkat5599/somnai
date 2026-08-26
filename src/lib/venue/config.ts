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
 * VERIFIED: active binary markets span TWO venue ids on testnet. Pinning the
 * single id published in the bot-kit README silently hides half the live book.
 * The bot-kit itself warns these "moved three times in the first week of
 * August" and says to read the venueId off a live row instead.
 *
 * So the default is to accept every venue and report which ones we saw, rather
 * than filter to a constant that rots.
 */
export const KNOWN_VENUE_IDS = {
  /** Published in the bot-kit README. Still carries active markets. */
  primary: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  /** Undocumented, but carrying the only struck markets as of 2026-08-25. */
  pricefeed: "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
} as const;

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

/** Cadences the venue actually lists, verified present and active. */
export const INTERVALS = [
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
  venueId: KNOWN_VENUE_IDS.primary,
} as const;
