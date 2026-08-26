"use client";

/**
 * Live Event Contract markets.
 *
 * Every row is a real market read off the Somnia indexer. Two states are shown
 * that a fixture would have hidden, and both matter to PRISM's thesis:
 *
 *   ROUTABLE — struck, Trading, and far enough from expiry to send an order.
 *   UNSTRUCK — listed by the venue with strike 0, i.e. the window exists but
 *              has not been struck yet. Most longer windows sit here.
 *
 * The venue lists ONE strike per (asset, window), and the routable ones are
 * five-minute windows. That is not a limitation to hide — it is the reason
 * PRISM composes positions across successive windows rather than across a
 * strike ladder.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Chip,
  PageHead,
  Segmented,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import { IconArrowOut, IconSearch } from "@/components/icons";
import type { EventMarket } from "@/lib/venue/types";
import { headroomSec } from "@/lib/venue/types";

type AssetFilter = "ALL" | "BTC" | "ETH";
type StateFilter = "ROUTABLE" | "ACTIVE" | "ALL";

/** mm:ss, or a plain marker once the window has closed. */
function countdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function MarketsView({
  markets,
  totalInRegistry,
  activeCount,
  routableCount,
  venueCount,
  network,
  fetchedAt,
}: {
  markets: EventMarket[];
  /** Whole registry size; `markets` carries only what this page renders. */
  totalInRegistry: number;
  activeCount: number;
  routableCount: number;
  venueCount: number;
  network: string;
  fetchedAt: number;
}) {
  const [asset, setAsset] = useState<AssetFilter>("ALL");
  const [state, setState] = useState<StateFilter>("ACTIVE");
  const [q, setQ] = useState("");

  // Windows are short enough that a static countdown would be wrong within
  // seconds. The first frame is already correct, so nothing depends on this
  // interval firing.
  const [now, setNow] = useState(() => Math.floor(fetchedAt / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return markets
      .filter((m) => {
        if (asset !== "ALL" && m.asset !== asset) return false;

        const left = m.expiry - now;
        const routable =
          m.active &&
          m.status === "Trading" &&
          m.strike !== null &&
          left > headroomSec(m.intervalSec);

        if (state === "ROUTABLE" && !routable) return false;
        if (state === "ACTIVE" && !m.active) return false;

        if (needle) {
          const hay = `${m.asset} ${m.symbol} ${m.interval} ${m.strike ?? ""} ${m.marketId}`;
          if (!hay.toLowerCase().includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.asset !== b.asset) return a.asset.localeCompare(b.asset);
        return a.intervalSec - b.intervalSec;
      });
  }, [markets, asset, state, q, now]);

  return (
    <>
      <PageHead
        title="Event Contract markets"
        lede="Live binary markets read from the Somnia indexer. The venue lists one strike per window, and a window that has not been struck yet carries strike 0 — both states are shown exactly as the venue reports them."
      >
        <Chip tone={routableCount > 0 ? "up" : "warn"} live={routableCount > 0}>
          {routableCount} routable
        </Chip>
      </PageHead>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line mb-5">
        {[
          { label: "Binary markets", value: String(totalInRegistry), sub: "in registry" },
          { label: "Active", value: String(activeCount), sub: "window open" },
          {
            label: "Routable",
            value: String(routableCount),
            sub: "struck + outside headroom",
          },
          { label: "Venues", value: String(venueCount), sub: `on ${network}` },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <span className="text-label-xs uppercase text-ink-3">{s.label}</span>
            <p className="num text-[17px] leading-[20px] text-ink mt-1.5">{s.value}</p>
            <p className="text-[12px] text-ink-3 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <label className="flex items-center border border-line h-9 focus-within:border-accent transition-colors min-w-[190px] flex-1 sm:flex-none sm:w-[240px]">
          <span className="pl-2.5 text-ink-4 shrink-0">
            <IconSearch size={15} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Asset, window, strike"
            aria-label="Search markets"
            className="flex-1 min-w-0 h-full bg-transparent px-2.5 text-[13px] text-ink placeholder:text-ink-4 outline-none"
          />
        </label>

        <Segmented
          label="Asset filter"
          options={[
            { value: "ALL" as const, label: "All" },
            { value: "BTC" as const, label: "BTC" },
            { value: "ETH" as const, label: "ETH" },
          ]}
          value={asset}
          onChange={setAsset}
        />

        <Segmented
          label="State filter"
          options={[
            { value: "ROUTABLE" as const, label: "Routable" },
            { value: "ACTIVE" as const, label: "Active" },
            { value: "ALL" as const, label: "All" },
          ]}
          value={state}
          onChange={setState}
        />
      </div>

      <div className="border border-line bg-surface">
        <TableWrap>
          <thead>
            <tr>
              <Th>Asset</Th>
              <Th align="center">Window</Th>
              <Th align="right">Strike</Th>
              <Th align="center">Status</Th>
              <Th align="right">Closes in</Th>
              <Th align="right">Trades</Th>
              <Th>Venue</Th>
              <Th>Market id</Th>
              <Th align="right">Build</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const left = m.expiry - now;
              const struck = m.strike !== null;
              const routable =
                m.active &&
                m.status === "Trading" &&
                struck &&
                left > headroomSec(m.intervalSec);

              return (
                <Tr key={m.marketId}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cx(
                          "w-[3px] h-[13px] shrink-0",
                          routable ? "bg-up" : struck ? "bg-warn" : "bg-line-strong",
                        )}
                      />
                      <span className="text-ink">{m.asset}</span>
                    </span>
                  </Td>
                  <Td align="center" mono tone="muted">
                    {m.interval}
                  </Td>
                  <Td align="right" mono tone={struck ? undefined : "muted"}>
                    {struck
                      ? m.strike!.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                        })
                      : "—"}
                  </Td>
                  <Td align="center">
                    {routable ? (
                      <Chip tone="up" live>
                        Routable
                      </Chip>
                    ) : struck ? (
                      <Chip tone="warn">{left <= 0 ? "Expired" : m.status}</Chip>
                    ) : (
                      <Chip tone="neutral">Unstruck</Chip>
                    )}
                  </Td>
                  <Td
                    align="right"
                    mono
                    tone={left <= 0 ? "muted" : left < 60 ? "down" : undefined}
                  >
                    {countdown(left)}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {m.tradeCount}
                  </Td>
                  <Td mono tone="muted">
                    {m.venueId ? `${m.venueId.slice(0, 8)}…` : "—"}
                  </Td>
                  <Td mono tone="muted">
                    {m.marketId.slice(0, 10)}…{m.marketId.slice(-4)}
                  </Td>
                  <Td align="right">
                    {routable ? (
                      <Link
                        href={`/trade?market=${encodeURIComponent(m.marketId)}`}
                        className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-ink-3 hover:text-accent transition-colors"
                      >
                        Route
                        <IconArrowOut size={13} />
                      </Link>
                    ) : (
                      <span
                        className="text-[12px] uppercase tracking-[0.05em] text-ink-4 cursor-not-allowed"
                        title={
                          struck
                            ? "Window is inside expiry headroom"
                            : "Venue has not struck this window yet"
                        }
                      >
                        {struck ? "Too late" : "Unstruck"}
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="h-24 text-center text-[13px] text-ink-3">
                  No markets match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>

        <div className="flex flex-wrap items-center justify-between gap-3 px-3 h-11 border-t border-line">
          <span className="text-[12px] text-ink-3">
            {rows.length} shown · {totalInRegistry} in registry
          </span>
          <span className="num text-[12px] text-ink-4">
            read from Somnia {network} ·{" "}
            {new Date(fetchedAt).toISOString().slice(11, 19)} UTC
          </span>
        </div>
      </div>
    </>
  );
}
