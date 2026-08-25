import type { Metadata } from "next";
import { getMarketSnapshot } from "@/lib/venue/markets";
import { getPriceSnapshot, type PriceSnapshot } from "@/lib/venue/prices";
import type { EventMarket } from "@/lib/venue/types";
import { TradeTerminal } from "./terminal";

export const metadata: Metadata = { title: "Trade — PRISM" };

/** Live venue state; a 5-minute window cannot be prerendered. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TradePage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>;
}) {
  const { market: wanted } = await searchParams;

  let selected: EventMarket | null = null;
  let routable: EventMarket[] = [];
  let venueError: string | null = null;
  let prices: PriceSnapshot | null = null;

  try {
    const snap = await getMarketSnapshot();
    routable = snap.routable;
    // Honour the marketId handed over by /markets. Falling back to "some other
    // market" would silently trade something the user did not choose, so an
    // unknown id resolves to nothing and the UI says so.
    selected = wanted
      ? (snap.all.find((m) => m.marketId === wanted) ?? null)
      : (snap.routable[0] ?? null);
  } catch (e) {
    venueError = e instanceof Error ? e.message : String(e);
  }

  // Oracle candles for whichever asset the ticket ended up on. Failure here is
  // not fatal to the page — the chart renders its own empty state.
  if (selected) {
    prices = await getPriceSnapshot(selected.asset, "1m", 240).catch(() => null);
  }

  return (
    <TradeTerminal
      market={selected}
      routable={routable}
      requestedId={wanted ?? null}
      venueError={venueError}
      prices={prices}
    />
  );
}
