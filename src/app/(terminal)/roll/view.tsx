"use client";

/**
 * The Roll Engine.
 *
 * PRISM's actual thesis, and the only composition this venue can genuinely
 * support. Event Contract windows expire every few minutes; a position that
 * wants a real tenor has to be re-struck into the successor each time.
 *
 * Every chain below is read from the registry — same asset, same cadence,
 * ordered by expiry. Nothing here is an invented queue: when the venue has not
 * listed a successor yet, that is stated rather than filled in.
 */

import { useEffect, useState } from "react";
import { Chip, Note, PageHead, Stat, cx } from "@/components/ui";
import { IconInfo, IconRoll } from "@/components/icons";
import { headroomSec } from "@/lib/venue/types";
import type { Succession } from "./page";
import { RollPanel } from "./roll-panel";

const mmss = (s: number) => {
  if (s <= 0) return "closed";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
};

export function RollView({
  successions,
  fetchedAt,
}: {
  successions: Succession[];
  fetchedAt: number;
}) {
  const [now, setNow] = useState(() => Math.floor(fetchedAt / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const chains = successions.length;
  const liveWindows = successions.reduce(
    (n, s) => n + s.windows.filter((w) => w.active).length,
    0,
  );
  const shortest = successions.reduce(
    (m, s) => Math.min(m, s.intervalSec),
    Number.POSITIVE_INFINITY,
  );

  return (
    <>
      <PageHead
        title="Roll Engine"
        lede="Event Contract windows die on schedule. The engine re-strikes a position into the successor market each time one expires, keyed by market id rather than pool address — pools are recycled across windows, so an address is not a stable identity."
      >
        <Chip tone={liveWindows > 0 ? "accent" : "neutral"} live={liveWindows > 0}>
          {chains} live {chains === 1 ? "chain" : "chains"}
        </Chip>
      </PageHead>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line mb-6">
        <div className="bg-surface p-4">
          <Stat label="Succession chains" value={String(chains)} sub="asset × cadence" />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Live windows" value={String(liveWindows)} sub="open right now" />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Shortest cadence"
            value={Number.isFinite(shortest) ? `${shortest}s` : "—"}
            sub="how often a roll comes due"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Roll execution"
            value="Manual"
            sub="preview and commit per chain"
            mono={false}
          />
        </div>
      </div>

      <Note icon={<IconInfo size={14} />} tone="accent">
        A window minutes from close can lock between the snapshot and the send,
        so headroom scales to a fraction of the series interval rather than a
        fixed threshold. A flat 300&nbsp;second rule would reject every market on
        a venue running five minute windows — which this one does.
      </Note>

      <div className="mt-6 flex flex-col gap-px bg-line border border-line">
        {successions.length === 0 ? (
          <div className="bg-surface p-8 text-center text-[13px] text-ink-3">
            The venue is listing no active succession chains right now.
          </div>
        ) : (
          successions.map((s) => (
            <Chain key={`${s.asset}-${s.intervalSec}`} succession={s} now={now} />
          ))
        )}
      </div>
    </>
  );
}

function Chain({ succession, now }: { succession: Succession; now: number }) {
  const { asset, interval, windows } = succession;
  const liveIndex = windows.findIndex((w) => w.active && w.expiry > now);
  const live = liveIndex >= 0 ? windows[liveIndex] : null;
  const closed = windows.filter((w) => w.expiry <= now).length;
  const upcoming = windows.filter((w, i) => w.expiry > now && i !== liveIndex).length;

  return (
    <section className="bg-surface p-5 min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <span className="inline-flex items-center gap-2.5">
          <IconRoll size={15} className="text-accent" />
          <span className="text-title-sm text-ink">
            {asset} · {interval}
          </span>
          <span className="num text-[11px] text-ink-4">
            {windows.length} window{windows.length === 1 ? "" : "s"} in registry
          </span>
        </span>
        {live ? (
          <Chip tone="up" live>
            {mmss(live.expiry - now)} to roll
          </Chip>
        ) : (
          <Chip tone="neutral">No open window</Chip>
        )}
      </header>

      <ol className="flex items-stretch overflow-x-auto">
        {windows.map((w, i) => {
          const left = w.expiry - now;
          const isLive = i === liveIndex;
          const isClosed = left <= 0;
          const tight = !isClosed && left <= headroomSec(w.intervalSec);
          const rel = liveIndex >= 0 ? i - liveIndex : i - windows.length + 1;
          return (
            <li key={w.marketId} className="flex items-stretch shrink-0">
              <div
                className={cx(
                  "w-[170px] border p-3 flex flex-col gap-1.5",
                  isLive
                    ? "border-[#0b4d54] bg-[#04191c]"
                    : isClosed
                      ? "border-line bg-base"
                      : "border-line bg-surface-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="num text-label-xs uppercase text-ink-3">
                    W{rel >= 0 ? `+${rel}` : rel}
                  </span>
                  <span
                    className={cx(
                      "text-label-xs uppercase",
                      isLive ? "text-accent" : isClosed ? "text-ink-4" : "text-ink-3",
                    )}
                  >
                    {isClosed ? "closed" : isLive ? "trading" : "successor"}
                  </span>
                </span>

                <span className="num text-[14px] text-ink">
                  {w.strike !== null
                    ? w.strike.toLocaleString("en-US", { minimumFractionDigits: 2 })
                    : "unstruck"}
                </span>

                <span
                  className={cx(
                    "num text-[11px]",
                    isClosed ? "text-ink-4" : tight ? "text-down" : "text-ink-3",
                  )}
                >
                  {mmss(left)}
                </span>

                <span className="num text-[10px] text-ink-4 truncate">
                  {w.marketId.slice(0, 8)}…{w.marketId.slice(-4)}
                </span>
              </div>

              {i < windows.length - 1 ? (
                <span aria-hidden className="self-center px-2 num text-[12px] text-ink-4">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {live ? <RollPanel marketId={live.marketId} /> : null}

      <p className="text-[11px] leading-[16px] text-ink-4 mt-3">
        {closed} closed · {live ? "1 trading" : "0 trading"} · {upcoming} successor
        {upcoming === 1 ? "" : "s"} listed.
        {upcoming === 0 ? (
          <span className="text-warn">
            {" "}
            Next contract not yet struck — the venue has not listed a successor.
          </span>
        ) : null}
      </p>
    </section>
  );
}
