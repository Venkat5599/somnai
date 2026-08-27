/**
 * Run a dreamBot Builder config against PRISM's execution path.
 *
 * The Builder emits a `.env` and tells you to run it against the bot kit. This
 * runs the same config through PRISM instead, which matters because the kit's
 * own documented failure modes are the ones PRISM was built around: a write
 * that resolves without throwing on a reverted transaction, `loadMarkets`
 * hiding the finalized markets you need to claim from, and floats reaching an
 * 18-decimal venue. The config stays portable; the execution gets verified.
 *
 *   bun --conditions react-server backend/bot/index.ts path/to/bot.env
 *   BOT_CONFIG=bot.env bun --conditions react-server backend/bot/index.ts
 *
 * SINGLE WRITER, like every other signing surface here. This process holds the
 * key and sends strictly one order at a time. Never run two of these on one
 * key: nonces are sequential and the loser dies with "nonce too low".
 *
 * ALL FIVE EC STRATEGIES RUN. The three resting ones — maker, passive bid,
 * ladder — were refused until PRISM had order cancellation, because each must
 * manage a quote after placing it and a post-only order that can never be
 * pulled leaves escrow locked in a market that settles. sdk/dreamdex/cancel.ts
 * closed that; backend/bot/quoting.ts is the loop they share.
 *
 *   ec-starter      taker, crosses the spread          runStarter
 *   ec-settlement   claims what already settled        runSettlement
 *   ec-market-maker post-only bid and ask around fair  runQuoting
 *   ec-passive-bid  one post-only bid                  runQuoting
 *   ec-ladder       post-only grid, flattened on exit  runQuoting
 */

import { readFileSync } from "node:fs";
import { parseBotConfig, supportFor, type BotConfig } from "../../sdk/bot/config";
import { getMarketSnapshot, exchange } from "../../sdk/venue/markets";
import { resolveVenueConfig, COLLATERAL, type VenueConfig } from "../../sdk/venue/config";
import { isRoutable, type EventMarket, type Outcome } from "../../sdk/venue/types";
import { placeLimit } from "../../sdk/dreamdex/place-limit";
import { rpc, readBalances } from "../../sdk/dreamdex/execution";
import { findClaimable, claim } from "../../sdk/dreamdex/settlement";
import { runQuoting } from "./quoting";
import type { Hex } from "viem";

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function loadConfig(): BotConfig {
  const path = process.argv[2] ?? process.env.BOT_CONFIG ?? "bot.env";

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    log(`FATAL: could not read ${path}`);
    log("Generate one at https://dreambot-builder.vercel.app (Event contracts),");
    log("save the .env block, and pass its path as the first argument.");
    process.exit(1);
  }

  const parsed = parseBotConfig(text);
  if (!parsed.ok) {
    log(`FATAL: ${parsed.error}`);
    process.exit(1);
  }
  return parsed.config;
}

/* ------------------------------------------------------------------ */
/* Position                                                            */
/* ------------------------------------------------------------------ */

/**
 * Net contracts opened by THIS process, per outcome.
 *
 * Session-local on purpose, and labelled as such wherever it is printed. The
 * honest number would come from ERC-6909 balances across every live market, and
 * PRISM reads those only for finalized ones during a settlement sweep. Claiming
 * a session counter is a true net position would be worse than admitting it is
 * a session counter: a restarted process would silently believe it was flat.
 */
class Book {
  private net = 0;
  add(outcome: Outcome, filled: number) {
    this.net += outcome === "YES" ? filled : -filled;
  }
  get value() {
    return this.net;
  }
  /** Would leaning further this way breach the configured cap? */
  blocked(outcome: Outcome, size: number, max: number): boolean {
    const after = this.net + (outcome === "YES" ? size : -size);
    return Math.abs(after) > max;
  }
}

/* ------------------------------------------------------------------ */
/* ec-starter — cross the spread on a live window                      */
/* ------------------------------------------------------------------ */

interface Quote {
  market: EventMarket;
  outcome: Outcome;
  price: number;
  depth: number;
}

/** The best crossable offer across the live board, or null if nothing rests. */
async function bestQuote(
  cfg: BotConfig,
  venue: VenueConfig,
): Promise<{ quote: Quote | null; scanned: number }> {
  const snap = await getMarketSnapshot(venue);
  const ex = exchange(venue);

  const live = snap.routable
    .filter((m) => isRoutable(m, Date.now()))
    .filter((m) => (cfg.asset ? m.asset === cfg.asset : true))
    // Longest-lived first: a book read costs real time, and a 60s window can
    // close inside the scan that is looking at it.
    .sort((a, b) => b.expiry - a.expiry);

  let best: Quote | null = null;
  for (const m of live) {
    for (const o of ["YES", "NO"] as Outcome[]) {
      try {
        const ob = await ex.fetchOrderBook(`${m.symbol}#${o}`);
        const asks = (ob.asks ?? []) as [number, number][];
        const top = asks[0];
        if (!top) continue;
        const depth = asks.reduce((n, [, s]) => n + s, 0);
        // Cheapest probability is the best value to a taker crossing in.
        if (!best || top[0] < best.price) best = { market: m, outcome: o, price: top[0], depth };
      } catch {
        /* an unreadable book is not a quote */
      }
    }
  }
  return { quote: best, scanned: live.length };
}

async function runStarter(cfg: BotConfig, venue: VenueConfig) {
  const book = new Book();
  let ticks = 0;

  for (;;) {
    ticks++;
    try {
      const { quote, scanned } = await bestQuote(cfg, venue);

      if (!quote) {
        log(`tick ${ticks}  ${scanned} live · nothing resting on either side`);
      } else if (book.blocked(quote.outcome, cfg.maxShares, cfg.maxPosition)) {
        log(
          `tick ${ticks}  would breach max position ${cfg.maxPosition} ` +
            `(session net ${book.value}) — standing down`,
        );
      } else {
        const { market, outcome, price } = quote;
        log(
          `tick ${ticks}  ${market.asset} ${market.interval} ${outcome} ` +
            `ask ${price.toFixed(3)} x${quote.depth} · taking ${cfg.maxShares}`,
        );

        if (cfg.dryRun) {
          log("  DRY_RUN=true — nothing signed.");
        } else {
          // The grid-safe raw tier: price and size become exact integers on the
          // venue's own tick and lot grid before anything is sent.
          const placed = await placeLimit(
            {
              marketId: market.marketId,
              outcome,
              side: "buy",
              price,
              size: cfg.maxShares,
              type: "ioc",
            },
            venue,
          );

          // The SDK's answer is evidence, not truth — read the receipt.
          if (!placed.hash) {
            log("  no hash returned; nothing was filled");
          } else {
            const receipt = await rpc(venue)
              .getTransactionReceipt({ hash: placed.hash as Hex })
              .catch(() => null);

            if (!receipt) {
              log(`  PENDING ${placed.hash} — receipt not yet available, not counted as filled`);
            } else if (receipt.status === "success") {
              book.add(outcome, placed.filled);
              log(
                `  VERIFIED filled ${placed.filled} · block ${receipt.blockNumber} · ` +
                  `session net ${book.value}`,
              );
              log(`  ${venue.explorer}/tx/${placed.hash}`);
            } else {
              log(`  REVERTED ${placed.hash} — nothing counted`);
            }
          }
        }
      }
    } catch (e) {
      // The indexer times out as routine. A bad tick is not a reason to stop.
      log(`tick ${ticks} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }

    await sleep(cfg.intervalMs);
  }
}

/* ------------------------------------------------------------------ */
/* ec-settlement — collect what already settled                        */
/* ------------------------------------------------------------------ */

async function runSettlement(cfg: BotConfig, venue: VenueConfig) {
  let ticks = 0;

  for (;;) {
    ticks++;
    try {
      // The registry deliberately excludes finalized markets, so this scans
      // listBinaryMarkets({ status: "Finalized" }) instead — the list a
      // redeem-by-registry can never see.
      const rows = await findClaimable(25, venue);
      if (!rows.length) {
        log(`tick ${ticks}  nothing claimable`);
      } else {
        log(`tick ${ticks}  ${rows.length} claimable`);
        for (const row of rows) {
          if (cfg.dryRun) {
            log(
              `  DRY_RUN  ${row.outcomeLabel} x${row.contracts} on ${row.marketId.slice(0, 12)}… ` +
                `→ ~${row.estimatedPayout.toFixed(6)} ${COLLATERAL.symbol}`,
            );
            continue;
          }
          const result = await claim(row, venue);
          log(
            `  ${result.status}  ${row.outcomeLabel} x${row.contracts} · ` +
              `${result.txHash ?? "no hash"}${
                result.collateralDelta !== null ? ` · delta ${result.collateralDelta.toFixed(6)}` : ""
              }`,
          );
        }
      }
    } catch (e) {
      log(`tick ${ticks} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }

    await sleep(Math.max(cfg.intervalMs, 30_000));
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const cfg = loadConfig();

  log(`dreamBot Builder config loaded · strategy ${cfg.strategy}`);
  log(`network ${cfg.network} · dryRun ${cfg.dryRun} · size ${cfg.maxShares} · every ${cfg.intervalMs}ms`);
  log(`underlying ${cfg.asset ?? "whatever the venue is running"} · max position ${cfg.maxPosition}`);
  for (const w of cfg.warnings) log(`WARNING: ${w}`);
  if (cfg.unknownKeys.length)
    log(`NOTE: unrecognised keys carried in the config: ${cfg.unknownKeys.join(", ")}`);

  const support = supportFor(cfg);
  if (!support.supported) {
    log(`REFUSING to run ${cfg.strategy}.`);
    log(support.reason);
    log("Run this one on the bot kit itself: https://github.com/somnia-chain/dreamdex-bot-kit");
    process.exit(2);
  }
  log(`${cfg.strategy}: ${support.reason}`);

  // The key comes from PRISM's own environment, never from the config block.
  const venue: VenueConfig = { ...resolveVenueConfig(), network: cfg.network, dryRun: cfg.dryRun };

  if (!cfg.dryRun) {
    const bal = await readBalances(venue).catch(() => null);
    if (!bal) {
      log("FATAL: DRY_RUN=false but no signer is configured. Set PRIVATE_KEY in PRISM's environment.");
      log("The Builder's own PRIVATE_KEY line is deliberately not read from the config.");
      process.exit(1);
    }
    log(
      `signer ${bal.address} · ${bal.collateral.toFixed(6)} ${COLLATERAL.symbol} · ${bal.gas.toFixed(6)} gas`,
    );
    if (bal.gas <= 0) {
      log("FATAL: no gas. Every transaction needs it, even when the collateral is there.");
      process.exit(1);
    }
  }

  if (cfg.strategy === "ec-settlement") await runSettlement(cfg, venue);
  else if (cfg.strategy === "ec-starter") await runStarter(cfg, venue);
  // maker, passive bid and ladder all share one quote-and-flatten loop.
  else await runQuoting(cfg, venue);
}

await main();
