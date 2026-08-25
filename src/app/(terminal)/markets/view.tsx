"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Page } from "@/components/shell";
import { DepthBar } from "@/components/charts";
import {
  Button,
  Chip,
  PageHead,
  Segmented,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import {
  IconArrowOut,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from "@/components/icons";
import { EXPIRY_OPTIONS, MARKETS, SPOT, type ExpiryLabel } from "@/lib/data";
import { fmtCompact, fmtProb, fmtUsd } from "@/lib/quant";

const PER_PAGE = 12;

export function MarketsView() {
  const [asset, setAsset] = useState<"ALL" | "BTC" | "ETH">("ALL");
  const [expiry, setExpiry] = useState<"ALL" | ExpiryLabel>("4h");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const interval =
      expiry === "ALL"
        ? null
        : EXPIRY_OPTIONS.find((e) => e.label === expiry)!.intervalSec;
    return MARKETS.filter(
      (m) =>
        (asset === "ALL" || m.asset === asset) &&
        (interval === null || m.intervalSec === interval) &&
        (q.trim() === "" ||
          m.symbol.toLowerCase().includes(q.trim().toLowerCase()) ||
          String(m.strike).includes(q.trim())),
    );
  }, [asset, expiry, q]);

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pages - 1);
  const slice = rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const maxDepth = Math.max(...rows.map((r) => r.depth), 1);

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <Page>
      <PageHead
        title="Event Contract markets"
        lede="Every live binary on the DreamDEX venue, priced as a risk-neutral probability. Depth is resting size within two percent of mid, which is what the router can actually fill against."
      >
        <Chip tone="accent" live>
          {rows.length} live
        </Chip>
      </PageHead>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <label className="flex items-center border border-line h-9 focus-within:border-accent transition-colors min-w-[190px] flex-1 sm:flex-none sm:w-[240px]">
          <span className="pl-2.5 text-ink-4 shrink-0">
            <IconSearch size={15} />
          </span>
          <input
            value={q}
            onChange={(e) => reset(() => setQ(e.target.value))}
            placeholder="Symbol or strike"
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
          onChange={(v) => reset(() => setAsset(v))}
        />

        <Segmented
          label="Expiry filter"
          options={[
            { value: "ALL" as const, label: "All" },
            ...EXPIRY_OPTIONS.map((e) => ({ value: e.label, label: e.label })),
          ]}
          value={expiry}
          onChange={(v) => reset(() => setExpiry(v))}
        />
      </div>

      <div className="border border-line bg-surface">
        <TableWrap>
          <thead>
            <tr>
              <Th>Market</Th>
              <Th align="right">Strike</Th>
              <Th align="right">Spot</Th>
              <Th align="center">Window</Th>
              <Th align="right">Up</Th>
              <Th align="right">Down</Th>
              <Th align="right">24h volume</Th>
              <Th align="right">Depth</Th>
              <Th align="center">Status</Th>
              <Th align="right">Build</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((m) => {
              const spot = SPOT[m.asset].price;
              const itm = spot > m.strike;
              return (
                <Tr key={m.marketId}>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cx(
                          "w-[3px] h-[13px] shrink-0",
                          itm ? "bg-up" : "bg-line-strong",
                        )}
                      />
                      <span className="text-ink">{m.symbol}</span>
                    </span>
                  </Td>
                  <Td align="right" mono>
                    {m.strike.toLocaleString("en-US")}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {fmtUsd(spot, 0)}
                  </Td>
                  <Td align="center" mono tone="muted">
                    {m.expiresAt}
                  </Td>
                  <Td align="right" mono tone={m.up >= 0.5 ? "up" : undefined}>
                    {fmtProb(m.up)}
                  </Td>
                  <Td align="right" mono tone={m.down >= 0.5 ? "down" : undefined}>
                    {fmtProb(m.down)}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {fmtCompact(m.vol24h)}
                  </Td>
                  <Td align="right" className="w-[120px]">
                    <DepthBar value={m.depth} max={maxDepth} side={itm ? "up" : "down"} />
                  </Td>
                  <Td align="center">
                    <Chip tone={m.status === "Trading" ? "up" : "neutral"} live={m.status === "Trading"}>
                      {m.status}
                    </Chip>
                  </Td>
                  <Td align="right">
                    <Link
                      href="/trade"
                      className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-ink-3 hover:text-accent transition-colors"
                    >
                      Route
                      <IconArrowOut size={13} />
                    </Link>
                  </Td>
                </Tr>
              );
            })}
            {slice.length === 0 ? (
              <tr>
                <td colSpan={10} className="h-24 text-center text-[13px] text-ink-3">
                  No markets match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>

        <div className="flex items-center justify-between gap-4 px-3 h-11 border-t border-line">
          <span className="text-[12px] text-ink-3">
            {rows.length === 0
              ? "0 markets"
              : `${safePage * PER_PAGE + 1}–${Math.min(
                  (safePage + 1) * PER_PAGE,
                  rows.length,
                )} of ${rows.length} markets`}
          </span>
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              leading={<IconChevronLeft size={14} />}
            >
              Prev
            </Button>
            <span className="num text-[12px] text-ink-3 px-2">
              {safePage + 1} / {pages}
            </span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={safePage >= pages - 1}
              trailing={<IconChevronRight size={14} />}
            >
              Next
            </Button>
          </span>
        </div>
      </div>
    </Page>
  );
}
