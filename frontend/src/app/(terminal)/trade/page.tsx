import type { Metadata } from "next";
import { exchange, successionChain } from "@sdk/venue/markets";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { resolveVenueConfig } from "@sdk/venue/config";
import type { PriceSnapshot } from "@sdk/venue/prices";
import { cachedPriceSnapshot } from "@sdk/venue/cache";
import { isRoutable, type EventMarket, type Outcome } from "@sdk/venue/types";
import { TradeTerminal } from "./terminal";

export const metadata: Metadata = { title: "Trade — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface BookSide {
  /** [price, size] best-first. */
  levels: [number, number][];
  /** Best price, or null when nothing is resting. */
  best: number | null;
  /** Contracts available at or better than the best level. */
  depth: number;
}

export interface MarketBook {
  YES: BookSide;
  NO: BookSide;
}

const emptySide = (): BookSide => ({ levels: [], best: null, depth: 0 });

/**
 * Total resting depth across both outcomes.
 *
 * Replaces a boolean "has a book". A market with one lot on one side satisfied
 * that check and rendered as "nothing to price against" a second later, so the
 * useful question is how much is resting, not whether anything is.
 */
async function totalDepth(m: EventMarket, config: ReturnType<typeof resolveVenueConfig>) {
  const ex = exchange(config);
  let depth = 0;
  for (const o of ["YES", "NO"] as Outcome[]) {
    try {
      const ob = await ex.fetchOrderBook(`${m.symbol}#${o}`);
      depth += ((ob.asks ?? []) as [number, number][]).reduce((n, [, s]) => n + s, 0);
    } catch {
      /* an unreadable book contributes nothing */
    }
  }
  return depth;
}

/** Does either outcome have a resting offer? Cheap enough to scan a few. */
async function hasBook(m: EventMarket, config: ReturnType<typeof resolveVenueConfig>) {
  const ex = exchange(config);
  for (const o of ["YES", "NO"] as Outcome[]) {
    try {
      const ob = await ex.fetchOrderBook(`${m.symbol}#${o}`);
      if (((ob.asks ?? []) as [number, number][])[0]) return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
}

export default async function TradePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  const { market: wanted } = await searchParams;

  let selected: EventMarket | null = null;
  let routable: EventMarket[] = [];
  let active: EventMarket[] = [];
  let succession: EventMarket[] = [];
  let book: MarketBook = { YES: emptySide(), NO: emptySide() };
  let prices: PriceSnapshot | null = null;
  let venueError: string | null = null;

  const config = resolveVenueConfig();

  try {
    const snap = await cachedMarketSnapshot();
    // Re-derived against the clock, not taken from the cached snapshot: the
    // terminal renders this list as "routable", and a 10s-stale 1m window is
    // already dead. The count in the header has to mean what it says.
    routable = snap.routable.filter((m) => isRoutable(m, Date.now()));
    active = snap.active;
    selected = wanted
      ? (snap.all.find((m) => m.marketId === wanted) ?? null)
      : null;

    // Auto-selection must prefer a market with a REAL book. Taking routable[0]
    // blindly lands the user on a market with no resting offer, where every
    // control is disabled and there is no path forward.
    //
    // BUT DEPTH IS NOT THE ONLY WAY TO LAND SOMEWHERE DEAD. Observed live: the
    // page opened on an ETH 1m window already showing MARKET EXPIRED, while two
    // other markets were routable. Two things caused it, and both are timing:
    //
    //   1. `snap.routable` was computed when the SNAPSHOT was fetched, and that
    //      snapshot is cached for 10s. A 1m window is only routable for 55s
    //      after its 5s headroom, so up to a fifth of its life can already be
    //      gone before this code runs.
    //   2. The scan below awaits a `fetchOrderBook` PER MARKET. Against this
    //      indexer that is not free, and a 60s window can die part-way through.
    //
    // So routability is re-derived against the clock HERE rather than trusted
    // from the snapshot, candidates are ordered by time remaining so the most
    // durable window is tried first, and the winner is re-checked after the
    // scan — because the scan itself is what consumes the time.
    if (!selected && snap.routable.length) {
      const durable = snap.routable
        .filter((m) => isRoutable(m, Date.now()))
        .sort((a, b) => b.expiry - a.expiry);

      // Prefer the market with the MOST resting depth, not merely the first one
      // that had any. A book with a single lot passes "hasBook" and is empty by
      // the time the page renders — which is exactly how /trade kept opening on
      // "no resting offer" while other windows were quoting.
      let best: { market: EventMarket; depth: number } | null = null;
      for (const m of durable) {
        const depth = await totalDepth(m, config);
        if (depth <= 0) continue;
        if (!best || depth > best.depth) best = { market: m, depth };
        // Enough to be worth trading; stop paying for book reads.
        if (best.depth >= 50) break;
      }
      // The scan took real time; the window may have closed inside it.
      if (best && isRoutable(best.market, Date.now())) selected = best.market;

      // Nothing has depth: bind the longest-lived market that is STILL open, so
      // the context renders and the UI can say plainly that no book exists.
      // Never fall back to a window that has already closed.
      selected ??= durable.find((m) => isRoutable(m, Date.now())) ?? null;
    }

    /**
     * NOTHING IS ROUTABLE. That is a real venue state, not an error.
     *
     * Windows are minutes long and the board genuinely empties between them, so
     * this page used to dead-end on "No routable market" with a link out —
     * which tells the reader nothing about how long to wait or what happens
     * next, and makes a normal thirty-second gap look like a broken product.
     *
     * The registry still knows what is coming. Bind the market that opens
     * SOONEST — struck but not yet trading, or trading but inside its expiry
     * headroom — so the ticket renders with a real countdown instead of an
     * apology. The panel refuses to route it; that refusal is already typed.
     */
    if (!selected) {
      const now = Math.floor(Date.now() / 1000);
      const live = snap.all.filter((m) => !m.finalized && !m.voided && m.expiry > now);

      // A STRUCK window first, always. Sorting purely by expiry landed the page
      // on unstruck markets — "this window has no strike yet, so it has no
      // payoff" — which is accurate and useless: there is no strike to draw a
      // curve from and nothing to price. A struck window closing later is a far
      // better thing to show than an unstruck one closing sooner, because the
      // reader can at least see the instrument.
      const struck = live
        .filter((m) => m.strike !== null)
        .sort((a, b) => a.expiry - b.expiry);

      // Only if the venue genuinely has not struck ANYTHING does an unstruck
      // window get bound — it still beats a dead end, and it counts down to the
      // moment it becomes real.
      const unstruck = live.sort((a, b) => a.expiry - b.expiry);

      selected = struck[0] ?? unstruck[0] ?? null;
    }

    if (selected) {
      // The succession chain IS the product thesis: what this view rolls into
      // when the window closes.
      succession = successionChain(snap, selected.asset, selected.intervalSec);

      // Real resting depth per outcome. Every number in the ticket is derived
      // from this, so nothing on screen can disagree with the book.
      const ex = exchange();
      const sides = await Promise.all(
        (["YES", "NO"] as Outcome[]).map(async (o) => {
          try {
            const ob = await ex.fetchOrderBook(`${selected!.symbol}#${o}`);
            // Buying an outcome lifts the ask.
            const asks = (ob.asks ?? []) as [number, number][];
            const best = asks[0]?.[0] ?? null;
            const depth = best === null ? 0 : asks.reduce((n, [, s]) => n + s, 0);
            return [o, { levels: asks, best, depth }] as const;
          } catch {
            return [o, emptySide()] as const;
          }
        }),
      );
      // Built explicitly rather than via Object.fromEntries, which widens the
      // key type to string and loses the YES/NO guarantee.
      book = {
        YES: sides.find(([o]) => o === "YES")?.[1] ?? emptySide(),
        NO: sides.find(([o]) => o === "NO")?.[1] ?? emptySide(),
      };

      prices = await cachedPriceSnapshot(selected.asset, "1m", 240).catch(() => null);
    }
  } catch (e) {
    venueError = e instanceof Error ? e.message : String(e);
  }

  /**
   * Land on the side that is actually quoting.
   *
   * Books on this venue are frequently ONE-SIDED, so defaulting to YES drops the
   * reader on "no resting offer, nothing to price against" with a dead Buy
   * button — while the page itself prints that NO is quoting. Knowing which side
   * has depth and opening the other one is the whole defect: the data was
   * already here, nothing acted on it.
   *
   * Depth decides, and YES only wins a tie because the venue quotes in YES terms.
   */
  const openingOutcome: Outcome =
    book.YES.depth > 0 || book.NO.depth === 0 ? "YES" : "NO";

  return (
    <TradeTerminal
      market={selected}
      openingOutcome={openingOutcome}
      routable={routable}
      active={active}
      succession={succession}
      book={book}
      prices={prices}
      requestedId={wanted ?? null}
      venueError={venueError}
    />
  );
}
