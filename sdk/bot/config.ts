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

/** Strategies the Builder offers on the Event contracts track. */
export const EC_STRATEGIES = [
  "ec-starter",
  "ec-market-maker",
  "ec-passive-bid",
  "ec-ladder",
  "ec-settlement",
] as const;

export type EcStrategy = (typeof EC_STRATEGIES)[number];

/**
 * What PRISM can actually run today, and why the rest cannot.
 *
 * The three resting strategies need to cancel and re-quote: a maker leans on
 * both sides and must move them as the mid moves, and the Builder's own
 * description of the Ladder says it is "flattened before expiry". PRISM has NO
 * order cancellation anywhere in the codebase — verified by search — so it can
 * place a post-only order and then never manage it. Running one would leave
 * resting size with escrow locked and no way to pull it, which the bot kit
 * calls the easiest way to lose track of collateral.
 *
 * So they are recognised and refused with the reason, rather than half-run.
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
  "ec-market-maker": {
    supported: false,
    reason:
      "Rests quotes on both sides and must re-quote as the mid moves. PRISM has no order cancellation, so a quote could be placed and never pulled.",
  },
  "ec-passive-bid": {
    supported: false,
    reason:
      "Rests a bid that must be repriced or withdrawn. PRISM has no order cancellation, so the bid could not be managed once placed.",
  },
  "ec-ladder": {
    supported: false,
    reason:
      "A grid of resting orders that the Builder itself flattens before expiry. Flattening requires cancellation, which PRISM does not have.",
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
  /** Blank in the Builder means "whatever the venue is running". */
  asset: "BTC" | "ETH" | null;
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

const RECOGNISED_SUFFIXES = ["MAX_SHARES", "MAX_POSITION", "INTERVAL_MS", "ASSET", "UNDERLYING"];
const RECOGNISED_EXACT = ["NETWORK", "DRY_RUN", "STRATEGY", "PRIVATE_KEY"];

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
  if (!(EC_STRATEGIES as readonly string[]).includes(rawStrategy))
    return {
      ok: false,
      error:
        `STRATEGY "${rawStrategy}" is not an Event Contracts strategy. ` +
        `PRISM trades binaries only; the Builder's Spot track is a different venue surface. ` +
        `Expected one of: ${EC_STRATEGIES.join(", ")}.`,
    };
  const strategy = rawStrategy as EcStrategy;

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
  let asset: "BTC" | "ETH" | null = null;
  if (rawAsset === "BTC" || rawAsset === "ETH") asset = rawAsset;
  else if (rawAsset) warn(`Underlying "${rawAsset}" is not BTC or ETH — trading whatever the venue is running.`);

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
