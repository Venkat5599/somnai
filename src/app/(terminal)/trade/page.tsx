import type { Metadata } from "next";
import { exchange, successionChain } from "@sdk/venue/markets";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { resolveVenueConfig } from "@sdk/venue/config";
import type { PriceSnapshot } from "@sdk/venue/prices";
import { cachedPriceSnapshot } from "@sdk/venue/cache";
import type { EventMarket, Outcome } from "@sdk/venue/types";
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
    routable = snap.routable;
    active = snap.active;
    selected = wanted
      ? (snap.all.find((m) => m.marketId === wanted) ?? null)
      : null;

    // Auto-selection must prefer a market with a REAL book. Taking routable[0]
    // blindly lands the user on a market with no resting offer, where every
    // control is disabled and there is no path forward — which is exactly the
    // dead end this used to produce.
    if (!selected && snap.routable.length) {
      for (const m of snap.routable) {
        const has = await hasBook(m, config);
        if (has) { selected = m; break; }
      }
      // Nothing has depth: bind the first routable anyway so the market context
      // still renders, and let the UI say plainly that no book exists.
      selected ??= snap.routable[0];
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

  return (
    <TradeTerminal
      market={selected}
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
