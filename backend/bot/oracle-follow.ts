/**
 * ec-oracle-follow — take the side the oracle implies, when the book disagrees.
 *
 * WHY THIS EXISTS AT ALL. PRISM shipped five EC strategies and said "all five
 * run". The kit ships six. This one was missing because the strategy list was
 * transcribed from the Builder's dropdown and never checked against the kit —
 * the same defect as the `INTERVALS` and `KNOWN_VENUE_IDS` constants, and
 * invisible for the same reason: nothing compared the list to its source.
 *
 * WHY PRISM CAN RUN IT PROPERLY. The kit documents that `ec-oracle-follow`
 * needs an underlying spot price, and that it EXITS AT STARTUP on mainnet
 * unless you wire in an external exchange ticker. A third-party ticker is a
 * poor substitute: it is not the number that settles these contracts, so the
 * strategy would be trading a basis it cannot see. PRISM already reads Somnia's
 * own on-chain EMA oracle (`sdk/venue/prices.ts`) — the exact feed the venue
 * resolves against. On testnet that is live, so this follows the settlement
 * source itself rather than a correlated proxy.
 *
 * THE MODEL, stated plainly. An Event Contract pays 1 if spot finishes above
 * the strike. Its fair price is therefore P(S_T > K), which `sdk/quant.ts`
 * computes as N(d2) from spot, strike, vol and time. The book quotes its own
 * probability. When the two disagree by more than the edge threshold, the
 * cheaper side is the one to take.
 *
 * WHAT IT REFUSES TO DO, and why each refusal is real money:
 *
 *   - Never trades an unstruck window. With `strike === null` there is nothing
 *     to compare the oracle against, so any signal would be invented.
 *   - Never trades without a live oracle observation. A stale price is a wrong
 *     edge, and a wrong edge is a confident wrong trade.
 *   - Never trades inside the expiry headroom, on the venue's own scaled rule.
 *   - Never crosses when the edge is below `EDGE`. Taking pays the spread, so a
 *     disagreement smaller than the cost of crossing is negative expectancy —
 *     the most common way a signal bot loses money while being "right".
 *   - Never leans past `maxPosition`, counted per market and side.
 *
 * IOC only, so nothing rests and no escrow is left locked in a market that is
 * about to settle. That also means this strategy needs no cancellation path.
 */

import { getMarketSnapshot, exchange } from "../../sdk/venue/markets";
import { resolveVenueConfig, type VenueConfig } from "../../sdk/venue/config";
import { getLivePrice } from "../../sdk/venue/prices";
import { isRoutable, withinHeadroom, type EventMarket, type Outcome } from "../../sdk/venue/types";
import { digitalUp } from "../../sdk/quant";
import { placeLimit } from "../../sdk/dreamdex/place-limit";
import { rpc } from "../../sdk/dreamdex/execution";
import type { BotConfig } from "../../sdk/bot/config";
import type { Hex } from "viem";

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Annualised vol used to turn a spot/strike gap into a probability.
 *
 * A CONSTANT, AND HONEST ABOUT IT. The venue lists one strike per window, so
 * there is no smile to imply vol from — that is the same constraint that makes
 * Range and Spread unconstructible here. Rather than pretend to a surface that
 * cannot exist, this uses a fixed figure and exposes it, so a reader can see
 * exactly what the signal assumes. `EDGE` is what actually protects the
 * strategy: a threshold wide enough that the trade survives being wrong about
 * vol.
 */
const ASSUMED_VOL = Number(process.env.PRISM_ORACLE_VOL ?? "0.6");

export interface OracleSignal {
  market: EventMarket;
  /** Live oracle spot. */
  spot: number;
  /** Model probability the window finishes above the strike. */
  fair: number;
  /** Best ask on the side the model prefers. */
  ask: number | null;
  outcome: Outcome;
  /** fair − ask, in probability. Positive means the book is cheap. */
  edge: number | null;
  /** Why no trade, when there is none. */
  blocker: string | null;
}

/**
 * Price one market against the oracle.
 *
 * Pure of side effects and never throws: a market that cannot be evaluated
 * yields a blocker, because a strategy loop must be able to report why it did
 * nothing as readily as why it acted.
 */
export async function signalFor(
  market: EventMarket,
  config: VenueConfig,
  edgeThreshold: number,
): Promise<OracleSignal | null> {
  const base: Omit<OracleSignal, "blocker"> = {
    market,
    spot: 0,
    fair: 0,
    ask: null,
    outcome: "YES",
    edge: null,
  };

  if (market.strike === null)
    return { ...base, blocker: "MARKET_UNSTRUCK" };
  if (withinHeadroom(market))
    return { ...base, blocker: "WITHIN_EXPIRY_HEADROOM" };

  const live = await getLivePrice(market.asset, config).catch(() => null);
  if (!live || !(live.price > 0))
    return { ...base, blocker: "NO_ORACLE_OBSERVATION" };

  const secondsLeft = market.expiry - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return { ...base, spot: live.price, blocker: "MARKET_EXPIRED" };
  const years = secondsLeft / (365 * 24 * 3600);

  // N(d2): the risk-neutral probability the window finishes above the strike.
  const fair = digitalUp(live.price, market.strike, ASSUMED_VOL, years);

  // Take the leg the model thinks is underpriced. A binary's NO is the exact
  // complement, so one comparison decides the side.
  const outcome: Outcome = fair >= 0.5 ? "YES" : "NO";
  const modelPrice = outcome === "YES" ? fair : 1 - fair;

  let ask: number | null = null;
  try {
    const ob = await exchange(config).fetchOrderBook(`${market.symbol}#${outcome}`);
    ask = ((ob.asks ?? []) as [number, number][])[0]?.[0] ?? null;
  } catch {
    ask = null;
  }

  const common = { ...base, spot: live.price, fair, outcome, ask };
  if (ask === null) return { ...common, blocker: "NO_BOOK_LIQUIDITY" };

  // Edge is what the model thinks the leg is worth, minus what it costs.
  const edge = modelPrice - ask;
  if (edge < edgeThreshold)
    return { ...common, edge, blocker: `EDGE_BELOW_THRESHOLD (${edge.toFixed(4)} < ${edgeThreshold})` };

  return { ...common, edge, blocker: null };
}

/**
 * The loop.
 *
 * Single writer, like every other signing surface in PRISM: one order in flight
 * at a time, because nonces are sequential and two senders on one key race.
 */
export async function runOracleFollow(cfg: BotConfig, venue: VenueConfig): Promise<void> {
  log(`strategy   ec-oracle-follow`);
  log(`oracle     Somnia on-chain EMA feed — the same price these contracts settle against`);
  log(`edge       ${cfg.edge} probability, assumed vol ${ASSUMED_VOL}`);
  log(`size       ${cfg.maxShares} contracts per trade, max position ${cfg.maxPosition}`);

  if (venue.network === "mainnet") {
    // The kit's documented limitation, restated rather than hidden. PRISM does
    // not claim a feed it has not verified on this network.
    log("");
    log("NOTE: the bot kit documents that ec-oracle-follow has no underlying spot");
    log("      source on mainnet and exits at startup there. PRISM reads Somnia's");
    log("      own EMA oracle, which is verified on testnet. If the mainnet feed");
    log("      returns nothing, every market will report NO_ORACLE_OBSERVATION and");
    log("      nothing will be traded — that is the honest outcome, not a bug.");
    log("");
  }

  // Contracts taken per (marketId, outcome), so the position cap is real rather
  // than a per-tick limit that leans further every interval.
  const held = new Map<string, number>();

  let ticks = 0;
  for (;;) {
    ticks++;
    try {
      const snap = await getMarketSnapshot(venue);
      const candidates = snap.routable
        .filter((m) => (cfg.asset ? m.asset === cfg.asset : true))
        .filter((m) => isRoutable(m))
        .sort((a, b) => a.expiry - b.expiry)
        .slice(0, 6);

      if (candidates.length === 0) {
        log(`tick ${ticks}  no routable market to evaluate`);
        await sleep(cfg.intervalMs);
        continue;
      }

      const blockers = new Map<string, number>();
      let acted = false;

      for (const market of candidates) {
        const sig = await signalFor(market, venue, cfg.edge);
        if (!sig) continue;

        if (sig.blocker) {
          const key = sig.blocker.split(" ")[0];
          blockers.set(key, (blockers.get(key) ?? 0) + 1);
          continue;
        }

        const posKey = `${market.marketId}|${sig.outcome}`;
        const already = held.get(posKey) ?? 0;
        if (already >= cfg.maxPosition) {
          blockers.set("MAX_POSITION", (blockers.get("MAX_POSITION") ?? 0) + 1);
          continue;
        }
        const size = Math.min(cfg.maxShares, cfg.maxPosition - already);

        log("");
        log(
          `tick ${ticks}  SIGNAL  ${market.asset} ${market.interval} ${sig.outcome}  ` +
            `spot ${sig.spot.toFixed(2)} vs strike ${market.strike}  ` +
            `fair ${sig.fair.toFixed(3)}  ask ${sig.ask?.toFixed(3)}  edge ${sig.edge?.toFixed(4)}`,
        );

        if (cfg.dryRun) {
          log(`          DRY_RUN — would buy ${size} ${sig.outcome} at ${sig.ask}`);
          acted = true;
          continue;
        }

        // IOC: fill now or not at all. Nothing rests, so no escrow is stranded
        // in a window that is about to settle.
        const placed = await placeLimit(
          {
            marketId: market.marketId,
            outcome: sig.outcome,
            side: "buy",
            price: sig.ask!,
            size,
            type: "ioc",
          },
          venue,
        );

        // The receipt decides, never the SDK's return value.
        let status = "UNKNOWN";
        if (placed.hash) {
          try {
            const receipt = await rpc(venue).getTransactionReceipt({ hash: placed.hash as Hex });
            status = receipt.status === "success" ? "VERIFIED_EXECUTED" : "VERIFIED_FAILED";
          } catch {
            status = "PENDING";
          }
        }

        log(`          ${status}  filled ${placed.filled}  tx ${placed.hash ?? "(none)"}`);
        if (status === "VERIFIED_EXECUTED" && placed.filled > 0)
          held.set(posKey, already + placed.filled);

        acted = true;
      }

      if (!acted) {
        const summary = [...blockers]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k}×${n}`)
          .join("  ");
        log(`tick ${ticks}  ${candidates.length} evaluated · ${summary || "nothing actionable"}`);
      }
    } catch (e) {
      // The testnet indexer times out regularly. A bad tick is not a reason to
      // abandon the run.
      log(`tick ${ticks}  failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`);
    }

    await sleep(cfg.intervalMs);
  }
}
