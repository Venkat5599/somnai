import type { Metadata } from "next";
import { getMarketSnapshot } from "@/lib/venue/markets";
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

  return (
    <TradeTerminal
      market={selected}
      routable={routable}
      requestedId={wanted ?? null}
      venueError={venueError}
    />
  );
}
