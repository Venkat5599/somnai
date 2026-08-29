"use client";

/**
 * The hero's artifact: PRISM's own instrument, carrying live venue data.
 *
 * WHAT THIS REPLACES. The reference hero (`hero-financial`) floats a stock
 * dashboard screenshot over a pastel gradient. Two things are wrong with that
 * here. The gradient is the candy-aurora tell — soft blurred colour rects, blue
 * wash, no relationship to the brand. And the dashboard is a PICTURE of a
 * product, which reads as a prop the moment anyone looks closely.
 *
 * A product-as-artifact is one of the strongest signatures available, but only
 * when the product is real and the panel is genuinely populated. PRISM has a
 * real instrument and real data, so this renders actual rows from the Somnia
 * registry — strike, cadence, oracle spot, live countdown, routability — rather
 * than a mock of them. Nothing here is invented; if the venue returns nothing,
 * it says so instead of drawing a plausible board.
 *
 * COMPOSITION. Clipped at the bottom edge so it reads as continuing past the
 * fold rather than sitting in a box, with a machined measure rail down the left
 * that carries real tick marks. Depth comes from tone and a self-coloured edge,
 * never from a bloom: the surface is a hair lighter than the page, the border is
 * the surface's own colour, and a single hairline highlight sits on the top lip
 * where light would catch. No drop shadow at all.
 */

import { useEffect, useState } from "react";
import { cx } from "./ui";

export interface InstrumentRow {
  marketId: string;
  asset: string;
  interval: string;
  strike: number | null;
  expiry: number;
  routable: boolean;
}

/** mm:ss, or the state once the window is gone. */
function clock(seconds: number): string {
  if (seconds <= 0) return "closed";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function HeroInstrument({
  rows,
  fetchedAt,
  routableCount,
  venueCount,
  oracle,
}: {
  rows: InstrumentRow[];
  /** Server timestamp. The clock ticks from here, so a cached snapshot is still correct. */
  fetchedAt: number;
  routableCount: number;
  venueCount: number;
  oracle: { asset: string; price: number }[];
}) {
  // First frame is already right; nothing depends on this interval firing.
  const [now, setNow] = useState(() => Math.floor(fetchedAt / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative">
      {/* Measure rail. A few real ticks, not a sheet of graph paper — the
          blueprint gesture only earns its place when it is sparing. */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-px bg-line-strong hidden sm:block"
      >
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className="absolute -left-[3px] w-[7px] h-px bg-line-strong"
            style={{ top: `${(i / 6) * 100}%` }}
          />
        ))}
      </div>

      <div
        className={cx(
          "sm:ml-5 bg-surface border border-line",
          // The top lip: a self-coloured inner highlight, not a border colour
          // change. You feel the edge rather than see a drawn line.
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.045)]",
          // Clipped at the bottom so the board reads as continuing past the
          // fold. The last row is deliberately partial.
          "overflow-hidden",
        )}
      >
        <header className="flex items-center justify-between h-10 px-4 border-b border-line">
          <span className="text-label-xs uppercase tracking-[0.05em] text-ink-3">
            Live board
          </span>
          <span className="num text-[11px] text-ink-4">
            {routableCount} routable · {venueCount} venue{venueCount === 1 ? "" : "s"}
          </span>
        </header>

        {oracle.length > 0 && (
          <div className="flex divide-x divide-line border-b border-line">
            {oracle.map((o) => (
              <div key={o.asset} className="flex-1 px-4 py-3 min-w-0">
                <p className="text-label-xs uppercase text-ink-4">{o.asset} oracle</p>
                <p className="num text-[15px] text-ink mt-1 truncate">
                  {o.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-ink-3">
            The venue returned no active markets. Nothing is being substituted.
          </p>
        ) : (
          <ul>
            {rows.map((r) => {
              const left = r.expiry - now;
              const live = r.routable && left > 0;
              return (
                <li
                  key={r.marketId}
                  className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 px-4 py-2.5 border-b border-line-soft last:border-b-0"
                >
                  <span className="num text-[12px] text-ink-2 truncate">
                    {r.asset}{" "}
                    <span className="text-ink-4">{r.interval}</span>
                  </span>
                  <span className="num text-[12px] text-ink tabular-nums">
                    {r.strike !== null ? r.strike.toLocaleString("en-US") : "unstruck"}
                  </span>
                  <span
                    className={cx(
                      "num text-[12px] tabular-nums w-[4.5rem] text-right",
                      live ? "text-accent" : "text-ink-4",
                    )}
                  >
                    {clock(left)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
