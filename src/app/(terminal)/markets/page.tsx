import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Note, PageHead } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { getMarketSnapshot } from "@/lib/venue/markets";
import { MarketsView } from "./view";

export const metadata: Metadata = { title: "Markets — PRISM" };

/**
 * Live venue state. Never prerendered: a 5-minute window baked at build time
 * would be expired before anyone loaded the page.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketsPage() {
  let snapshot: Awaited<ReturnType<typeof getMarketSnapshot>> | null = null;
  let error: string | null = null;

  try {
    snapshot = await getMarketSnapshot();
  } catch (e) {
    // Surface the failure rather than falling back to fixtures. A page that
    // silently substitutes generated data for an unreachable venue is exactly
    // the failure mode this integration exists to remove.
    error = e instanceof Error ? e.message : String(e);
  }

  if (!snapshot) {
    return (
      <Page>
        <PageHead
          title="Event Contract markets"
          lede="Live binary markets on the DreamDEX venue, read from the Somnia indexer."
        />
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">Venue unreachable.</span> The
          indexer did not answer, so there is nothing live to show. No cached or
          generated data is being substituted.
          <span className="block mt-1.5 num text-[11px] text-ink-4">{error}</span>
        </Note>
      </Page>
    );
  }

  return (
    <Page>
      <MarketsView
        markets={snapshot.all}
        activeCount={snapshot.active.length}
        routableCount={snapshot.routable.length}
        venueCount={Object.keys(snapshot.venues).length}
        network={snapshot.network}
        fetchedAt={snapshot.fetchedAt}
      />
    </Page>
  );
}
