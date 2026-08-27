/**
 * The resting strategies: market maker, passive bid, ladder.
 *
 * All three share one loop — pick a market, derive fair from its book, rest
 * post-only orders around it, pull them when fair moves or the window nears
 * expiry. The only thing that differs is which quotes `desiredQuotes` emits, so
 * the loop is written once and the strategy chooses the shape.
 *
 * THE RULE THAT MATTERS MOST IS THE LAST ONE. A quote still resting when its
 * window settles is escrow locked in a market that no longer trades — and since
 * `loadMarkets` drops finalized markets, it becomes hard to even find again. So
 * this flattens inside the venue's own expiry headroom and stands down, and it
 * flattens on SIGINT too: a process killed mid-quote would otherwise leave
 * exactly that behind.
 */

import type { BotConfig } from "../../sdk/bot/config";
import type { VenueConfig } from "../../sdk/venue/config";
import { getMarketSnapshot, exchange } from "../../sdk/venue/markets";
import { headroomSec, isRoutable } from "../../sdk/venue/types";
import { placeLimit } from "../../sdk/dreamdex/place-limit";
import { flatten, restingOrders } from "../../sdk/dreamdex/cancel";
import {
  desiredQuotes,
  fairFromBook,
  shouldRequote,
  type QuoteStrategy,
} from "../../sdk/dreamdex/quotes";
import { TICK } from "../../sdk/constants";

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runQuoting(cfg: BotConfig, venue: VenueConfig) {
  const strategy = cfg.strategy as QuoteStrategy;
  let ticks = 0;
  let boundMarket: string | null = null;
  let lastFair: number | null = null;

  /**
   * Flatten on the way out.
   *
   * Without this, Ctrl-C during a live run leaves quotes resting with nothing
   * left to manage them — the exact failure that made these strategies unsafe
   * before PRISM had cancellation.
   */
  let closing = false;
  const bail = async () => {
    if (closing) return;
    closing = true;
    if (boundMarket && !cfg.dryRun) {
      log("shutting down — flattening resting quotes");
      const r = await flatten(boundMarket, venue).catch(() => null);
      log(r ? `  ${r.status} · ${r.stillResting.length} still resting` : "  flatten failed");
    }
    process.exit(0);
  };
  process.on("SIGINT", bail);
  process.on("SIGTERM", bail);

  for (;;) {
    ticks++;
    try {
      const snap = await getMarketSnapshot(venue);
      const ex = exchange(venue);

      // Quote the longest-lived routable window, so a re-quote cycle is not
      // spent on a market that is about to close anyway.
      const market =
        snap.routable
          .filter((m) => isRoutable(m, Date.now()))
          .filter((m) => (cfg.asset ? m.asset === cfg.asset : true))
          .sort((a, b) => b.expiry - a.expiry)[0] ?? null;

      // The window we were quoting is gone, or we are moving to another one:
      // pull everything off the old book first.
      if (boundMarket && (!market || market.marketId !== boundMarket)) {
        log(`tick ${ticks}  leaving ${boundMarket.slice(0, 12)}… — flattening`);
        if (!cfg.dryRun) {
          const r = await flatten(boundMarket, venue);
          log(`  ${r.status} · ${r.stillResting.length} still resting`);
        }
        boundMarket = null;
        lastFair = null;
      }

      if (!market) {
        log(`tick ${ticks}  nothing routable to quote`);
        await sleep(cfg.intervalMs);
        continue;
      }

      const left = market.expiry - Math.floor(Date.now() / 1000);
      const headroom = headroomSec(market.intervalSec);

      if (left <= headroom) {
        log(`tick ${ticks}  ${left}s left, inside ${headroom}s headroom — standing down`);
        if (boundMarket && !cfg.dryRun) {
          const r = await flatten(boundMarket, venue);
          log(`  ${r.status} · ${r.stillResting.length} still resting`);
        }
        boundMarket = null;
        lastFair = null;
        await sleep(cfg.intervalMs);
        continue;
      }

      const ob = await ex.fetchOrderBook(`${market.symbol}#YES`);
      const bestBid = ((ob.bids ?? []) as [number, number][])[0]?.[0] ?? null;
      const bestAsk = ((ob.asks ?? []) as [number, number][])[0]?.[0] ?? null;
      const fair = fairFromBook(bestBid, bestAsk);

      if (fair === null) {
        log(`tick ${ticks}  ${market.asset} ${market.interval} · both sides empty, nothing to anchor to`);
        await sleep(cfg.intervalMs);
        continue;
      }

      const resting = cfg.dryRun ? [] : await restingOrders(market.marketId, venue);
      const bound = boundMarket === market.marketId;

      // Re-quoting costs a cancel plus a place and loses price-time priority.
      // Not worth it for a move the grid cannot even express.
      if (bound && resting.length > 0 && !shouldRequote(lastFair, fair, TICK)) {
        log(
          `tick ${ticks}  fair ${fair.toFixed(3)} · ${resting.length} resting · ` +
            "inside half a tick, standing pat",
        );
        await sleep(cfg.intervalMs);
        continue;
      }

      const quotes = desiredQuotes(strategy, {
        fair,
        spread: cfg.spread,
        size: cfg.maxShares,
        levels: cfg.levels,
        step: cfg.step,
        tick: TICK,
      });

      log(
        `tick ${ticks}  ${market.asset} ${market.interval} · fair ${fair.toFixed(3)} · ` +
          `${quotes.length} quote(s) · ${left}s left`,
      );
      for (const q of quotes) log(`  ${q.side.padEnd(4)} ${q.outcome} ${q.size} @ ${q.price.toFixed(3)}`);

      if (cfg.dryRun) {
        log("  DRY_RUN=true — nothing signed.");
        boundMarket = market.marketId;
        lastFair = fair;
        await sleep(cfg.intervalMs);
        continue;
      }

      // Pull the old quotes BEFORE placing new ones. The other order would rest
      // two sets at once and let the maker trade across its own book.
      if (resting.length) {
        const r = await flatten(market.marketId, venue);
        log(`  cancelled ${r.orderIds.length} · ${r.status} · ${r.stillResting.length} still resting`);
        if (r.stillResting.length) {
          // Quoting on top of orders we failed to pull is how a maker ends up
          // on both sides of its own book.
          log("  NOT re-quoting: some orders could not be pulled");
          await sleep(cfg.intervalMs);
          continue;
        }
      }

      for (const q of quotes) {
        try {
          const placed = await placeLimit(
            {
              marketId: market.marketId,
              outcome: q.outcome,
              side: q.side,
              price: q.price,
              size: q.size,
              // POST_ONLY: a maker that crosses is a taker paying the spread,
              // which is the one thing these strategies exist not to do.
              type: "post-only",
              // Never outlive the window, capped inside placeLimit at the
              // market's own expiry regardless.
              expiresInSec: Math.max(30, left - headroom),
            },
            venue,
          );
          log(`  rested ${q.side} @ ${q.price.toFixed(3)} · order ${placed.orderId ?? "none"}`);
        } catch (e) {
          log(`  quote rejected: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`);
        }
      }

      boundMarket = market.marketId;
      lastFair = fair;
    } catch (e) {
      // The indexer times out as routine. A bad tick is not a reason to stop.
      log(`tick ${ticks} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    }

    await sleep(cfg.intervalMs);
  }
}
