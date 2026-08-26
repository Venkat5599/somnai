import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Note, PageHead } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { successionChain } from "@sdk/venue/markets";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { INTERVALS } from "@sdk/venue/config";
import type { Asset, EventMarket } from "@sdk/venue/types";
import { RollView } from "./view";

export const metadata: Metadata = { title: "Roll Engine — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface Succession {
  asset: Asset;
  intervalSec: number;
  interval: string;
  /** Ordered by expiry: what a carried position actually moves through. */
  windows: EventMarket[];
}

export default async function RollPage() {
  let successions: Succession[] = [];
  let error: string | null = null;

  try {
    const snap = await cachedMarketSnapshot();
    // Every real cadence the venue lists, for both assets. These chains are read
    // from the registry — no queue is invented when the venue has none.
    for (const asset of ["BTC", "ETH"] as Asset[]) {
      for (const { sec, label } of INTERVALS) {
        const windows = successionChain(snap, asset, sec);
        // 817 KB came from serializing EVERY window ever listed per chain.
        // A succession chain only needs the recent past and the near future:
        // the closed windows before the live one, and whatever follows it.
        if (windows.length) {
          const liveIdx = windows.findIndex((w) => w.active);
          const from = liveIdx >= 0 ? Math.max(0, liveIdx - 2) : Math.max(0, windows.length - 4);
          successions.push({
            asset,
            intervalSec: sec,
            interval: label,
            windows: windows.slice(from, from + 6),
          });
        }
      }
    }
    successions = successions
      .filter((s) => s.windows.some((w) => w.active))
      .sort((a, b) =>
        a.asset === b.asset ? a.intervalSec - b.intervalSec : a.asset.localeCompare(b.asset),
      );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <Page>
        <PageHead
          title="Roll Engine"
          lede="Carry one view across successive Event Contract windows."
        />
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">Venue unreachable.</span> No
          succession data could be read. Nothing is being substituted.
          <span className="block mt-1.5 num text-[11px] text-ink-4">{error}</span>
        </Note>
      </Page>
    );
  }

  return (
    <Page>
      <RollView successions={successions} fetchedAt={Date.now()} />
    </Page>
  );
}
