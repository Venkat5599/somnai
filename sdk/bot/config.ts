/**
 * dreamBot Builder config, parsed.
 *
 * The Builder (dreambot-builder.vercel.app) is Somnia's no-code front end for
 * the DreamDEX bot kit. It walks Strategy → Network → Tune → Deploy and emits
 * exactly one artifact: a `.env` block. Nothing else. Verified by walking it:
 *
 *     NETWORK=testnet
 *     DRY_RUN=true
 *     STRATEGY=ec-starter
 *     PRIVATE_KEY=0x...
 *     TAKE_MAX_SHARES=5
 *     TAKE_MAX_POSITION=20
 *     TAKE_INTERVAL_MS=8000
 *
 * That makes the integration a LOADER, not a dependency: PRISM parses the block
 * a user generated and runs that strategy against its own verified execution
 * path — the one that snaps to the venue's integer grid and re-derives every
 * outcome from chain rather than trusting the SDK's return value.
 *
 * WHY NOT JUST RUN THE BOT KIT. Because the kit's own documented failure modes
 * are the ones PRISM was built around: a write that resolves without throwing
 * on a reverted transaction, `loadMarkets` hiding the finalized markets you
 * need to claim from, floats reaching an 18-decimal venue. Running a Builder
 * config through PRISM keeps the config portable and the execution verified.
 *
 * THE KEY IS DELIBERATELY NOT PARSED. The Builder's block carries a
 * `PRIVATE_KEY=` line, and this parser reads every other key and drops that
 * one on the floor — it reports only whether a real key is present, never its
 * value. A config object gets logged, serialised into errors and passed around;
 * a private key must not travel with it. PRISM reads the key from the
 * environment, in one place, exactly as it already does.
 *
 * Pure and dependency-free, so the tests can exercise it without a venue.
 */

import { KNOWN_ASSETS } from "../venue/types";

/**
 * The kit's canonical STRATEGY values — its names, not ours.
 *
 * THIS LIST WAS WRONG, and wrong in the way that matters: PRISM invented
 * `ec-market-maker`, `ec-passive-bid` and `ec-ladder` from the Builder's UI
 * labels, and `parseBotConfig` REJECTED anything else. So a config carrying the
 * kit's own documented value — `STRATEGY=ec-maker` — failed to load with
 * "not an Event Contracts strategy". The integration claimed to run the kit's
 * strategies while refusing three of the kit's strategy names.
 *
 * Source of truth: dreamdex-bot-kit `docs/event-contracts.md`, which tabulates
 * the STRATEGY value for each. Verified against the repo's `strategies/`
 * directory names, which agree. `scripts/probe-bot-kit.ts` re-reads that list
 * from GitHub and fails if it has moved — because a hand-written list checked
 * against nothing is exactly how this drifted in the first place.
 */
export const EC_STRATEGIES = [
  "ec-starter",
  "ec-maker",
  "ec-passive",
  "ec-laddering-bot",
  "ec-oracle-follow",
  "ec-settlement",
] as const;

export type EcStrategy = (typeof EC_STRATEGIES)[number];

/**
 * The Builder's UI labels, mapped onto the kit's canonical values.
 *
 * Both are real. The no-code Builder emits names that read well in a dropdown;
 * the kit's docs and directories use terser ones. A config is portable only if
 * PRISM accepts either, so these are aliases rather than a correction — and
 * `canonicalStrategy` is the one place the mapping happens.
 */
export const STRATEGY_ALIASES: Readonly<Record<string, EcStrategy>> = {
  "ec-market-maker": "ec-maker",
  "ec-passive-bid": "ec-passive",
  "ec-ladder": "ec-laddering-bot",
  // Seen in the wild on older Builder exports and in the kit's own prose.
  "ec-ladder-bot": "ec-laddering-bot",
  "ec-oracle": "ec-oracle-follow",
};

/** Resolve any accepted spelling to the kit's canonical value, or null. */
export function canonicalStrategy(raw: string): EcStrategy | null {
  const k = raw.toLowerCase().trim();
  if ((EC_STRATEGIES as readonly string[]).includes(k)) return k as EcStrategy;
  return STRATEGY_ALIASES[k] ?? null;
}

/**
 * What PRISM can run, and why.
 *
 * The three resting strategies were refused here until PRISM had order
 * cancellation, because each of them must manage a quote after placing it: a
 * maker moves both sides as the mid moves, and the Builder's own description of
 * the Ladder says it is "flattened before expiry". Placing a post-only order
 * that could never be pulled would leave escrow locked in a settled market —
 * what the bot kit calls the easiest way to lose track of collateral.
 *
 * `sdk/dreamdex/cancel.ts` closed that gap: cancelOrder / cancelOrders through
 * the raw trader tier, with what is STILL resting re-read from chain rather
 * than inferred from a receipt.
 *
 * All SIX run. The sixth — `ec-oracle-follow` — was not refused; it was simply
 * absent, because this list was written from the Builder's dropdown and never
 * checked against the kit.
 */
export const STRATEGY_SUPPORT: Record<EcStrategy, { supported: boolean; reason: string }> = {
  // A taker that crosses the spread — exactly what placeLimit(type:"ioc") does,
  // through the grid-safe raw tier, with the outcome read from the receipt.
  "ec-starter": {
    supported: true,
    reason: "Crosses the spread; runs on PRISM's verified IOC path.",
  },
  "ec-settlement": {
    supported: true,
    reason: "Claims finalized markets through findClaimable + claim, fee-aware.",
  },
  "ec-maker": {
    supported: true,
    reason: "Rests a post-only bid and ask around fair, re-quoting as it moves.",
  },
  "ec-passive": {
    supported: true,
    reason: "Rests one post-only bid, repriced as fair moves. Never pays the spread.",
  },
  "ec-laddering-bot": {
    supported: true,
    reason: "A post-only grid each side of the mid, flattened inside expiry headroom.",
  },
  /**
   * The sixth strategy, and the one PRISM did not know existed.
   *
   * It was missing because the strategy list was hand-written from the Builder
   * UI and never checked against the kit — the same defect shape as the
   * `INTERVALS` and `KNOWN_VENUE_IDS` constants. The README said "all five
   * run", which read as completeness of a set that has six members.
   *
   * PRISM is unusually well placed for this one: the kit documents that
   * `ec-oracle-follow` needs an underlying spot price and EXITS AT STARTUP on
   * mainnet unless you wire an external exchange ticker. PRISM already reads
   * Somnia's own on-chain EMA oracle in `sdk/venue/prices.ts` — the same feed
   * these contracts settle against, not a third-party ticker that would merely
   * look similar. On testnet that feed is live, so the strategy runs on the
   * settlement source itself. The mainnet limitation is the kit's and is
   * reported honestly at startup rather than papered over.
   */
  "ec-oracle-follow": {
    supported: true,
    reason:
      "Compares Somnia's on-chain EMA oracle against the strike and takes the side " +
      "the oracle implies, once past an edge threshold.",
  },
};

export interface BotConfig {
  strategy: EcStrategy;
  network: "testnet" | "mainnet";
  /** True unless the config explicitly says otherwise. Fail safe. */
  dryRun: boolean;
  /** Contracts per trade. Builder: *_MAX_SHARES. */
  maxShares: number;
  /** Net position the strategy stops leaning past. Builder: *_MAX_POSITION. */
  maxPosition: number;
  /** Poll interval in ms. Builder: *_INTERVAL_MS. */
  intervalMs: number;
  /**
   * Blank in the Builder means "whatever the venue is running".
   *
   * Open, not a `"BTC" | "ETH"` union: this was refusing any other underlying
   * and silently falling back to trading everything, so a config that named a
   * third asset would have been honoured as "no filter at all" — the opposite
   * of what the operator wrote. Whatever the venue lists, the config can name.
   */
  asset: string | null;
  /** Width between bid and ask, in probability. Resting strategies only. */
  spread: number;
  /** Levels per side for the ladder. */
  levels: number;
  /** Distance between ladder levels, in probability. */
  step: number;

  /**
   * Venue scoping. The kit lists `VENUE_ID` as REQUIRED and publishes a
   * different id per network; PRISM was ignoring the key entirely, so a config
   * that scoped itself to one venue silently traded across all of them.
   * Null means unscoped, which is PRISM's default and stays valid.
   */
  venueId: string | null;

  /** `AUTO_CLAIM` — sweep settled winnings alongside the strategy. Kit default true. */
  autoClaim: boolean;
  /** `AUTO_CLAIM_INTERVAL_MS`. Kit default 600000. */
  autoClaimIntervalMs: number;
  /** `CLAIM_SCAN` — how many finalized markets to scan. Kit default 25. */
  claimScan: number;

  /**
   * `EDGE` — minimum |oracle-implied probability − book price| before
   * `ec-oracle-follow` will cross. Below it the oracle disagrees with the book
   * by less than the spread costs to take, so trading is negative-edge.
   */
  edge: number;
  /** Whether the block carried a syntactically valid key. NEVER the key itself. */
  hasKey: boolean;
  /** Keys present in the block that this parser did not recognise. */
  unknownKeys: string[];
  /** Non-fatal problems worth showing the user. */
  warnings: string[];
}

export type ParseResult =
  | { ok: true; config: BotConfig }
  | { ok: false; error: string };

/** A dotenv-ish line reader. Tolerates comments, blanks, quotes and `export`. */
function readPairs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim().toUpperCase();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, and any trailing comment on an
    // unquoted value.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out.set(key, value);
  }
  return out;
}

/**
 * Find a tuned parameter regardless of the Builder's per-strategy prefix.
 *
 * VERIFIED for ec-starter, which emits `TAKE_MAX_SHARES`, `TAKE_MAX_POSITION`
 * and `TAKE_INTERVAL_MS`. The other strategies were not walked, and their
 * prefixes are presumably different (a maker is not a taker). Matching on the
 * suffix rather than pinning `TAKE_` means a config from any of them parses
 * instead of silently falling back to defaults — a wrong size is worse than a
 * rejected config, because it trades.
 */
function findBySuffix(pairs: Map<string, string>, suffix: string): string | undefined {
  const exact = pairs.get(suffix);
  if (exact !== undefined) return exact;
  for (const [k, v] of pairs) if (k.endsWith(`_${suffix}`)) return v;
  return undefined;
}

const RECOGNISED_SUFFIXES = [
  "MAX_SHARES",
  "MAX_POSITION",
  "INTERVAL_MS",
  "ASSET",
  "UNDERLYING",
  "SPREAD",
  "LEVELS",
  "STEP",
  // ec-oracle-follow: how far the oracle must disagree with the book to trade.
  "EDGE",
];
/**
 * Exact keys the kit documents as common to every EC strategy.
 *
 * `VENUE_ID`, `AUTO_CLAIM`, `AUTO_CLAIM_INTERVAL_MS` and `CLAIM_SCAN` were all
 * missing, so a kit-shaped config reported four "unrecognised keys" and PRISM
 * ignored settings the operator had deliberately set — including the venue
 * scope, which the kit marks REQUIRED.
 */
const RECOGNISED_EXACT = [
  "NETWORK",
  "DRY_RUN",
  "STRATEGY",
  "PRIVATE_KEY",
  "VENUE_ID",
  "AUTO_CLAIM",
  "AUTO_CLAIM_INTERVAL_MS",
  "CLAIM_SCAN",
];

const num = (v: string | undefined, fallback: number, warn: (s: string) => void, label: string) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    warn(`${label} is "${v}", which is not a positive number — using ${fallback}.`);
    return fallback;
  }
  return n;
};

/**
 * Parse a Builder `.env` block.
 *
 * Rejects rather than guesses when the strategy is missing or unrecognised: a
 * config whose strategy cannot be identified must not fall back to some default
 * that trades.
 */
export function parseBotConfig(text: string): ParseResult {
  if (!text || !text.trim()) return { ok: false, error: "The config is empty." };

  const pairs = readPairs(text);
  if (pairs.size === 0)
    return { ok: false, error: "No KEY=value lines found. Paste the whole .env block from the Builder." };

  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);

  const rawStrategy = (pairs.get("STRATEGY") ?? "").toLowerCase().trim();
  if (!rawStrategy)
    return { ok: false, error: "No STRATEGY line. The Builder always emits one, e.g. STRATEGY=ec-starter." };
  // Accept the kit's canonical value OR the Builder's UI label. Rejecting
  // `ec-maker` — the kit's own documented value — is what this used to do.
  const strategy = canonicalStrategy(rawStrategy);
  if (!strategy)
    return {
      ok: false,
      error:
        `STRATEGY "${rawStrategy}" is not an Event Contracts strategy. ` +
        `PRISM trades binaries only; the Builder's Spot track is a different venue surface. ` +
        `Expected one of: ${EC_STRATEGIES.join(", ")} ` +
        `(Builder labels ${Object.keys(STRATEGY_ALIASES).join(", ")} are accepted too).`,
    };
  if (strategy !== rawStrategy)
    warn(`STRATEGY "${rawStrategy}" is the Builder's label for "${strategy}" — running that.`);

  const rawNetwork = (pairs.get("NETWORK") ?? "testnet").toLowerCase().trim();
  if (rawNetwork !== "testnet" && rawNetwork !== "mainnet")
    return { ok: false, error: `NETWORK "${rawNetwork}" is neither testnet nor mainnet.` };

  // Fail safe, matching resolveVenueConfig: only an explicit "false" disarms.
  const rawDry = (pairs.get("DRY_RUN") ?? "true").toLowerCase().trim();
  const dryRun = rawDry !== "false";
  if (rawDry !== "true" && rawDry !== "false")
    warn(`DRY_RUN is "${rawDry}", which is not true or false — treating it as true, so nothing will be signed.`);

  const key = pairs.get("PRIVATE_KEY") ?? "";
  const hasKey = /^0x[0-9a-fA-F]{64}$/.test(key);
  if (key && !hasKey)
    warn(
      key.startsWith("0x")
        ? "PRIVATE_KEY is present but is not 64 hex characters after 0x."
        : "PRIVATE_KEY is missing its 0x prefix. MetaMask exports the key without it; type it in front yourself.",
    );
  if (!dryRun && !hasKey)
    warn("DRY_RUN is false but no usable key is in the config. PRISM reads the key from its own environment.");

  const rawAsset = (findBySuffix(pairs, "ASSET") ?? findBySuffix(pairs, "UNDERLYING") ?? "")
    .toUpperCase()
    .trim();
  // Any underlying the operator names is honoured. Rejecting an unrecognised
  // one used to set `asset = null`, which does not mean "refused" downstream —
  // it means "trade EVERY asset", so a typo silently widened the bot's scope
  // instead of narrowing it. An unknown name now filters to nothing and says so.
  const asset: string | null = rawAsset === "" ? null : rawAsset;
  if (asset && !KNOWN_ASSETS.includes(asset))
    warn(
      `Underlying "${asset}" is not one PRISM has a price feed for. It will still be ` +
        `matched against the registry; if the venue does not list it, no market is selected.`,
    );

  const unknownKeys = [...pairs.keys()].filter(
    (k) =>
      !RECOGNISED_EXACT.includes(k) &&
      !RECOGNISED_SUFFIXES.some((s) => k === s || k.endsWith(`_${s}`)),
  );

  return {
    ok: true,
    config: {
      strategy,
      network: rawNetwork,
      dryRun,
      maxShares: num(findBySuffix(pairs, "MAX_SHARES"), 1, warn, "MAX_SHARES"),
      maxPosition: num(findBySuffix(pairs, "MAX_POSITION"), 10, warn, "MAX_POSITION"),
      intervalMs: num(findBySuffix(pairs, "INTERVAL_MS"), 8000, warn, "INTERVAL_MS"),
      spread: num(findBySuffix(pairs, "SPREAD"), 0.04, warn, "SPREAD"),
      edge: num(findBySuffix(pairs, "EDGE"), 0.03, warn, "EDGE"),
      venueId: pairs.get("VENUE_ID")?.trim() || null,
      // Kit default is ON. Only an explicit "false" turns claiming off, so a
      // typo leaves winnings being swept rather than silently abandoned.
      autoClaim: (pairs.get("AUTO_CLAIM") ?? "true").toLowerCase().trim() !== "false",
      autoClaimIntervalMs: num(pairs.get("AUTO_CLAIM_INTERVAL_MS"), 600_000, warn, "AUTO_CLAIM_INTERVAL_MS"),
      claimScan: num(pairs.get("CLAIM_SCAN"), 25, warn, "CLAIM_SCAN"),
      levels: num(findBySuffix(pairs, "LEVELS"), 3, warn, "LEVELS"),
      step: num(findBySuffix(pairs, "STEP"), 0.01, warn, "STEP"),
      asset,
      hasKey,
      unknownKeys,
      warnings,
    },
  };
}

/** Can PRISM run this config, and if not, why not? */
export function supportFor(config: BotConfig): { supported: boolean; reason: string } {
  return STRATEGY_SUPPORT[config.strategy];
}

/**
 * The env PRISM would run this config under.
 *
 * Returned rather than applied: mutating process.env from a parser would make
 * the mapping invisible at the call site. The key is absent by construction.
 */
export function toPrismEnv(config: BotConfig): Record<string, string> {
  return {
    PRISM_NETWORK: config.network,
    PRISM_DRY_RUN: String(config.dryRun),
    PRISM_MAX_ORDER_CONTRACTS: String(config.maxShares),
  };
}
