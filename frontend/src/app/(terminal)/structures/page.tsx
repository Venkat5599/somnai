import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import { Button, Chip, Note, PageHead, cx } from "@/components/ui";
import { IconArrowRight, IconInfo, IconLayers, IconRoll } from "@/components/icons";
import { successionChain } from "@sdk/venue/markets";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { headroomSec, type Asset, type EventMarket } from "@sdk/venue/types";
import { structureMatrix, type Constructibility } from "@sdk/venue/structures";
import { resolveVenueConfig } from "@sdk/venue/config";
import { BasketPanel } from "./basket-panel";

export const metadata: Metadata = { title: "Structures — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Structures, restricted to what this venue can actually express.
 *
 * Range, Spread and Ladder are absent rather than shown as disabled cards, and
 * an inert card would still imply a capability that does not exist.
 *
 * WHAT CHANGED: the reason for their absence used to be a paragraph. Prose does
 * not re-check itself, so if the venue ever listed a second strike on one
 * expiry this page would go on saying it had not. The verdict now comes from
 * `structureMatrix(snap.all)` — live counts of strikes per expiry and expiries
 * per asset — and the note prints the numbers it was decided from.
 *
 * What survives today is real:
 *   DIRECTIONAL — one live market, one leg.
 *   CALENDAR    — one strike carried across a succession chain.
 */
export default async function StructuresPage() {
  let routable: EventMarket[] = [];
  let chains: { asset: Asset; interval: string; windows: EventMarket[] }[] = [];
  let matrix: Constructibility[] = [];
  let error: string | null = null;

  try {
    const snap = await cachedMarketSnapshot();
    routable = snap.routable;
    // Verdicts come from the registry, not from the paragraph below.
    matrix = structureMatrix(snap.all);
    // Cadences come off the LIVE BOARD, never from the INTERVALS constant.
    //
    // Iterating the constant meant this page could only ever show the five
    // cadences someone wrote down. Verified 2026-08-27: the venue also lists 51
    // markets at 60s, so every 1m succession chain was invisible here while the
    // trade terminal happily bound to one.
    const cadences = new Map<string, { asset: Asset; sec: number; label: string }>();
    for (const m of snap.active) {
      const key = `${m.asset}|${m.interval}`;
      if (!cadences.has(key))
        cadences.set(key, { asset: m.asset, sec: m.intervalSec, label: m.interval });
    }
    for (const { asset, sec, label } of cadences.values()) {
      const windows = successionChain(snap, asset, sec);
      if (windows.filter((w) => w.active).length)
        chains.push({ asset, interval: label, windows });
    }
    chains = chains.sort((a, b) => a.asset.localeCompare(b.asset));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const now = Math.floor(Date.now() / 1000);
  const blocked = matrix.filter((m) => !m.constructible);

  return (
    <Page>
      <PageHead
        title="Structures"
        lede="What PRISM can express against this venue today. Each card is a live market, not a template — open one and the terminal binds to that exact contract."
      >
        <Chip tone={routable.length ? "up" : "warn"} live={routable.length > 0}>
          {routable.length} routable
        </Chip>
      </PageHead>

      {/* The absence is explained with the counts it was decided from, read on
          this request. If the venue ever lists a second strike on one expiry,
          this note stops claiming otherwise without anyone editing it. */}
      <Note icon={<IconInfo size={14} />} tone={blocked.length ? "warn" : "accent"}>
        {blocked.length ? (
          <>
            <span className="font-medium text-ink">
              {blocked.map((b) => b.kind.charAt(0) + b.kind.slice(1).toLowerCase()).join(", ")}{" "}
              {blocked.length === 1 ? "is" : "are"} not listed here.
            </span>{" "}
            {blocked[0].reason} They are absent rather than shown disabled,
            because an inert card still implies the capability exists.
          </>
        ) : (
          <>
            <span className="font-medium text-ink">
              Every structure is constructible on this read.
            </span>{" "}
            {matrix[0]?.reason}
          </>
        )}
      </Note>

      {error ? (
        <div className="mt-6">
          <Note tone="warn" icon={<IconInfo size={14} />}>
            <span className="font-medium text-ink">Venue unreachable.</span>{" "}
            No structures can be listed.
            <span className="block mt-1.5 num text-[11px] text-ink-4">{error}</span>
          </Note>
        </div>
      ) : null}

      {/* ---- DIRECTIONAL: one live market, one leg ---- */}
      <h2 className="text-title-sm text-ink mt-8 mb-1">Directional</h2>
      <p className="text-[13px] text-ink-3 mb-4 max-w-[68ch]">
        A single Event Contract. Buy YES if you expect the underlying above the
        strike at close, NO otherwise. One leg, fully routable.
      </p>

      {routable.length === 0 ? (
        <div className="border border-line bg-surface p-8 text-center text-[13px] text-ink-3">
          No routable market right now. Windows are minutes long; the venue will
          list another shortly.
        </div>
      ) : (
        <div className="grid gap-px bg-line border border-line sm:grid-cols-2 xl:grid-cols-4">
          {routable.map((m) => {
            const left = m.expiry - now;
            return (
              <article key={m.marketId} className="bg-surface p-5 flex flex-col min-w-0">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-title-sm text-ink truncate">
                      {m.asset} · {m.interval}
                    </h3>
                    <p className="num text-[12px] text-ink-3 mt-1">
                      strike{" "}
                      {m.strike?.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <Chip tone="up" live>
                    Live
                  </Chip>
                </header>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-soft pt-4">
                  <div>
                    <dt className="text-label-xs uppercase text-ink-4">Closes in</dt>
                    <dd
                      className={cx(
                        "num text-[13px] mt-1",
                        left <= headroomSec(m.intervalSec) ? "text-down" : "text-ink",
                      )}
                    >
                      {Math.max(0, Math.floor(left / 60))}m{" "}
                      {Math.max(0, left % 60)}s
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-xs uppercase text-ink-4">Legs</dt>
                    <dd className="num text-[13px] text-ink mt-1 inline-flex items-center gap-1.5">
                      <IconLayers size={13} className="text-ink-4" />1
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-xs uppercase text-ink-4">Trades</dt>
                    <dd className="num text-[13px] text-ink-2 mt-1">{m.tradeCount}</dd>
                  </div>
                  <div>
                    <dt className="text-label-xs uppercase text-ink-4">Min size</dt>
                    <dd className="num text-[13px] text-ink-2 mt-1">{m.minAmount}</dd>
                  </div>
                </dl>

                <div className="mt-auto pt-5">
                  <Link
                    href={`/trade?market=${encodeURIComponent(m.marketId)}`}
                    className="block"
                  >
                    <Button variant="ghost" size="md" block trailing={<IconArrowRight size={15} />}>
                      Open in terminal
                    </Button>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Multi-leg. This is the caller sdk/dreamdex/batch.ts did not have —
          the README claimed the UI printed the delivered guarantee while
          nothing imported the module at all. */}
      <BasketPanel routable={routable} explorer={resolveVenueConfig().explorer} />

      {/* ---- CALENDAR: one strike carried across succession ---- */}
      <h2 className="text-title-sm text-ink mt-10 mb-1">Calendar</h2>
      <p className="text-[13px] text-ink-3 mb-4 max-w-[68ch]">
        One view carried across a succession chain. The venue re-lists each
        cadence continuously, so a five minute window becomes a real tenor by
        re-striking into the successor. This is composition along time rather
        than along a strike ladder.
      </p>

      {chains.length === 0 ? (
        <div className="border border-line bg-surface p-8 text-center text-[13px] text-ink-3">
          No active succession chain right now.
        </div>
      ) : (
        <div className="grid gap-px bg-line border border-line sm:grid-cols-2 xl:grid-cols-4">
          {chains.map((c) => {
            const live = c.windows.find((w) => w.active && w.expiry > now);
            return (
              <article
                key={`${c.asset}-${c.interval}`}
                className="bg-surface p-5 flex flex-col min-w-0"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-title-sm text-ink truncate">
                      {c.asset} · {c.interval}
                    </h3>
                    <p className="num text-[12px] text-ink-3 mt-1">
                      {c.windows.length} windows listed
                    </p>
                  </div>
                  <IconRoll size={15} className="text-accent shrink-0" />
                </header>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-soft pt-4">
                  <div>
                    <dt className="text-label-xs uppercase text-ink-4">Current strike</dt>
                    <dd className="num text-[13px] text-ink mt-1">
                      {live?.strike?.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      }) ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-xs uppercase text-ink-4">Roll every</dt>
                    <dd className="num text-[13px] text-ink-2 mt-1">{c.interval}</dd>
                  </div>
                </dl>

                <div className="mt-auto pt-5">
                  <Link href="/roll" className="block">
                    <Button variant="ghost" size="md" block trailing={<IconArrowRight size={15} />}>
                      View succession
                    </Button>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Page>
  );
}
