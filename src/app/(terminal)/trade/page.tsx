import type { Metadata } from "next";
import { exchange, successionChain } from "@sdk/venue/markets";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
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

  try {
    const snap = await cachedMarketSnapshot();
    routable = snap.routable;
    active = snap.active;
    selected = wanted
      ? (snap.all.find((m) => m.marketId === wanted) ?? null)
      : (snap.routable[0] ?? null);

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
