import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import { PriceChart } from "@/components/price-chart";
import {
  Chip,
  Note,
  PageHead,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import { IconArrowOut, IconInfo } from "@/components/icons";
import { getMarketSnapshot } from "@/lib/venue/markets";
import { getPriceSnapshot } from "@/lib/venue/prices";
import { headroomSec, type Asset, type EventMarket } from "@/lib/venue/types";

export const metadata: Metadata = { title: "Analytics — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Term structure, not a volatility surface.
 *
 * The previous version of this page inverted a strike ladder into a
 * risk-neutral density and an implied-vol surface. That maths was correct and
 * the inputs were fiction: recovering a density requires differentiating
 * ACROSS STRIKES, and this venue lists exactly one strike per window. There is
 * nothing to differentiate.
 *
 * What the venue does provide is five real cadences per asset. One strike
 * observed across 5m / 15m / 1h / 4h / 24h is a genuine term structure, and it
 * is the axis PRISM actually composes along. Every number below is read from
 * the indexer or the on-chain oracle.
 */
export default async function AnalyticsPage() {
  const [snap, btc, eth] = await Promise.all([
    getMarketSnapshot().catch(() => null),
    getPriceSnapshot("BTC", "1m", 180).catch(() => null),
    getPriceSnapshot("ETH", "1m", 180).catch(() => null),
  ]);

  if (!snap) {
    return (
      <Page>
        <PageHead title="Term structure" lede="Read from the Somnia indexer and oracle." />
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">Venue unreachable.</span> Nothing
          is being substituted.
        </Note>
      </Page>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const spot: Record<Asset, number | null> = {
    BTC: btc?.live?.price ?? null,
    ETH: eth?.live?.price ?? null,
  };

  const byAsset = (a: Asset): EventMarket[] =>
    snap.active.filter((m) => m.asset === a).sort((x, y) => x.intervalSec - y.intervalSec);

  const rows = (["BTC", "ETH"] as Asset[]).flatMap((a) =>
    byAsset(a).map((m) => {
      const s = spot[a];
      const moneyness = s && m.strike ? m.strike / s - 1 : null;
      const left = m.expiry - now;
      return { market: m, asset: a, spot: s, moneyness, left };
    }),
  );

  const struck = rows.filter((r) => r.market.strike !== null).length;

  return (
    <Page>
      <PageHead
        title="Term structure"
        lede="The venue lists one strike per window and five cadences per asset. That is a term structure, not a strike ladder — so this page reads along time, which is the axis PRISM actually composes along."
      >
        <Chip tone="accent" live>
          {snap.active.length} active
        </Chip>
      </PageHead>

      <Note icon={<IconInfo size={14} />} tone="warn">
        <span className="font-medium text-ink">
          No risk-neutral density or implied-vol surface is shown.
        </span>{" "}
        Both require differentiating across strikes on a single expiry, and this
        venue lists exactly one strike per window. Publishing either would mean
        inventing the rungs they are computed from.
      </Note>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line my-6">
        <div className="bg-surface p-4">
          <Stat
            label="BTC oracle"
            value={spot.BTC ? spot.BTC.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
            sub="on-chain EMA feed"
            tone="accent"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="ETH oracle"
            value={spot.ETH ? spot.ETH.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
            sub="on-chain EMA feed"
            tone="accent"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Struck windows" value={String(struck)} sub={`of ${rows.length} active`} />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Cadences" value="5" sub="5m · 15m · 1h · 4h · 24h" mono={false} />
        </div>
      </div>

      <div className="grid gap-px bg-line border border-line lg:grid-cols-2 mb-6">
        {([["BTC", btc], ["ETH", eth]] as const).map(([asset, p]) => (
          <section key={asset} className="bg-surface flex flex-col min-w-0">
            <header className="flex items-center justify-between h-11 px-4 border-b border-line">
              <span className="text-label-xs uppercase text-ink-3">{asset} / USD</span>
              <span className="text-label-xs uppercase text-ink-4">oracle · 1m</span>
            </header>
            <div className="p-4">
              {p ? (
                <PriceChart
                  candles={p.candles}
                  live={p.live}
                  asset={asset}
                  timeframe={p.timeframe}
                  height={240}
                />
              ) : (
                <p className="text-[12px] text-ink-3">Oracle feed unavailable.</p>
              )}
            </div>
          </section>
        ))}
      </div>

      <section className="border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 h-11 px-4 border-b border-line">
          <span className="text-label-xs uppercase text-ink-3">
            Live term structure
          </span>
          <span className="text-label-xs uppercase text-ink-4">
            strike vs oracle, by cadence
          </span>
        </header>

        <TableWrap>
          <thead>
            <tr>
              <Th>Asset</Th>
              <Th align="center">Cadence</Th>
              <Th align="right">Strike</Th>
              <Th align="right">Oracle</Th>
              <Th align="right">Moneyness</Th>
              <Th align="right">Closes in</Th>
              <Th align="center">Status</Th>
              <Th align="right">Trade</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ market: m, asset, spot: s, moneyness, left }) => {
              const routable =
                m.strike !== null &&
                m.status === "Trading" &&
                left > headroomSec(m.intervalSec);
              return (
                <Tr key={m.marketId}>
                  <Td>{asset}</Td>
                  <Td align="center" mono tone="muted">
                    {m.interval}
                  </Td>
                  <Td align="right" mono tone={m.strike === null ? "muted" : undefined}>
                    {m.strike !== null
                      ? m.strike.toLocaleString("en-US", { minimumFractionDigits: 2 })
                      : "unstruck"}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {s ? s.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}
                  </Td>
                  <Td
                    align="right"
                    mono
                    tone={
                      moneyness === null ? "muted" : moneyness >= 0 ? "up" : "down"
                    }
                  >
                    {moneyness === null
                      ? "—"
                      : `${moneyness >= 0 ? "+" : ""}${(moneyness * 100).toFixed(2)}%`}
                  </Td>
                  <Td align="right" mono tone={left <= 0 ? "muted" : undefined}>
                    {left <= 0
                      ? "closed"
                      : `${Math.floor(left / 60)}m ${left % 60}s`}
                  </Td>
                  <Td align="center">
                    <Chip tone={routable ? "up" : "neutral"} live={routable}>
                      {routable ? "Routable" : m.strike === null ? "Unstruck" : m.status}
                    </Chip>
                  </Td>
                  <Td align="right">
                    {routable ? (
                      <Link
                        href={`/trade?market=${encodeURIComponent(m.marketId)}`}
                        className={cx(
                          "inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em]",
                          "text-ink-3 hover:text-accent transition-colors",
                        )}
                      >
                        Route
                        <IconArrowOut size={13} />
                      </Link>
                    ) : (
                      <span className="text-[12px] uppercase tracking-[0.05em] text-ink-4">
                        —
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      </section>

      <p className="text-[12px] leading-[19px] text-ink-4 mt-5 max-w-[80ch]">
        Method: strikes and cadences are read from the Somnia indexer; the spot
        reference is the chain&apos;s own EMA oracle, the same feed the contracts
        settle against. Moneyness is strike over oracle less one. No implied
        volatility is quoted, because inverting a digital price for sigma is only
        conditioning on information this venue does not publish — a second strike
        on the same expiry.
      </p>
    </Page>
  );
}
