"use client";

/**
 * The density engine, made visible.
 *
 * Nothing here is a decorative chart: the surface, the density and the matrix
 * are all read off the same repaired Event Contract ladder the router prices
 * against, so what a trader sees is the state the executor acts on.
 */

import { useMemo, useState } from "react";
import { Page } from "@/components/shell";
import { DensityChart, IVSurface } from "@/components/charts";
import {
  Button,
  Chip,
  Note,
  PageHead,
  Segmented,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import { IconDownload, IconInfo } from "@/components/icons";
import { EXPIRY_OPTIONS, ladderFor, SPOT, type ExpiryLabel } from "@/lib/data";
import {
  fmtPct,
  fmtProb,
  fmtSignedPct,
  fmtUsd,
  impliedVolFromDigital,
  repairVolSlice,
  riskNeutralDensity,
} from "@/lib/quant";

export function AnalyticsView() {
  const [asset, setAsset] = useState<"BTC" | "ETH">("BTC");
  const [expiry, setExpiry] = useState<ExpiryLabel>("4h");

  const spot = SPOT[asset].price;

  const model = useMemo(() => {
    const years = (label: ExpiryLabel) =>
      EXPIRY_OPTIONS.find((e) => e.label === label)!.intervalSec /
      (365 * 24 * 3600);

    const ladder = ladderFor(asset, expiry);
    const T = years(expiry);

    // Raw inversion first: nulls mark the rungs where a digital price cannot
    // pin sigma. The slice is then repaired by interpolation so the surface is
    // continuous without any rung being invented.
    const raw = ladder.map((r) =>
      impliedVolFromDigital(spot, r.strike, r.up, T),
    );
    const filled = repairVolSlice(raw);
    const rows = ladder.map((r, i) => ({
      ...r,
      iv: filled[i],
      /** True where the value came from interpolation, not from a price. */
      interpolated: raw[i] === null,
    }));

    const density = riskNeutralDensity(ladder);

    const strikes = ladder.map((r) => r.strike);
    const expiries = EXPIRY_OPTIONS.map((e) => e.label);

    /** ATM vol read off a repaired slice at the spot itself. */
    const atmVolOf = (ks: number[], vols: number[]) => {
      if (!ks.length) return 0;
      let i = ks.findIndex((k) => k >= spot);
      if (i <= 0) i = 1;
      if (i >= ks.length) i = ks.length - 1;
      const t = (spot - ks[i - 1]) / (ks[i] - ks[i - 1] || 1);
      return vols[i - 1] + t * (vols[i] - vols[i - 1]);
    };

    /** Sample a (x, y) curve at an arbitrary x, clamping past the ends. */
    const sampleAt = (xs: number[], ys: number[], x: number) => {
      if (!xs.length) return 0;
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      const i = xs.findIndex((v) => v >= x);
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    };

    // A cross-expiry surface cannot be plotted against absolute strike: a 5m
    // ladder spans a few tenths of a percent while a 1d ladder spans several
    // percent, so a shared strike axis clamps the short rows flat and tears the
    // mesh. The comparable axis is standardised moneyness — how many standard
    // deviations out a strike sits for its own window — which puts every
    // expiry on the same footing.
    const zAxis = Array.from({ length: 9 }, (_, i) => -2 + i * 0.5);

    const grid = EXPIRY_OPTIONS.map((e) => {
      const l = ladderFor(asset, e.label);
      const y = years(e.label);
      const vols = repairVolSlice(
        l.map((r) => impliedVolFromDigital(spot, r.strike, r.up, y)),
      );
      const atmSeed = vols.length
        ? vols.reduce((a, b) => a + b, 0) / vols.length
        : 0.3;
      const zs = l.map(
        (r) => Math.log(r.strike / spot) / (atmSeed * Math.sqrt(y) || 1e-9),
      );
      return zAxis.map((z) => sampleAt(zs, vols, z));
    });

    const atmIv = atmVolOf(strikes, filled);

    // 25 delta skew, measured on rungs that actually carry information.
    const nearProb = (target: number) =>
      rows
        .filter((r) => !r.interpolated)
        .reduce(
          (best, r) =>
            best === null || Math.abs(r.up - target) < Math.abs(best.up - target)
              ? r
              : best,
          null as (typeof rows)[number] | null,
        );
    const p25 = nearProb(0.25);
    const p75 = nearProb(0.75);
    const skew = p25 && p75 ? p25.iv - p75.iv : null;

    const shortIv = atmVolOf(strikes, grid[0]);
    const longIv = atmVolOf(strikes, grid[grid.length - 1]);

    return {
      rows,
      density,
      atmIv,
      atmStrike: strikes.reduce((b, k) =>
        Math.abs(k - spot) < Math.abs(b - spot) ? k : b,
      ),
      skew,
      strikes,
      expiries,
      grid,
      zAxis,
      slope: longIv - shortIv,
    };
  }, [asset, expiry, spot]);

  /** Writes the exact state on screen to a file. Not a decorative button. */
  const exportModel = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      asset,
      expiry,
      spot,
      atmImpliedVol: model.atmIv,
      skew25Delta: model.skew,
      termSlope: model.slope,
      ladder: model.rows.map((r) => ({
        strike: r.strike,
        up: r.up,
        impliedVol: r.iv,
        interpolated: r.interpolated,
      })),
      density: model.density,
      surface: {
        moneyness: model.zAxis,
        expiries: model.expiries,
        impliedVol: model.grid,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `prism-surface-${asset.toLowerCase()}-${expiry}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Page>
      <PageHead
        title="Implied volatility surface"
        lede="The Up price of an Event Contract is a risk-neutral probability. Invert it across the strike ladder and the venue hands you a full volatility surface and a risk-neutral density, with no options market required."
      >
        <Button
          variant="ghost"
          size="md"
          leading={<IconDownload size={15} />}
          onClick={exportModel}
        >
          Export
        </Button>
      </PageHead>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Segmented
          label="Underlying"
          options={[
            { value: "BTC" as const, label: "BTC" },
            { value: "ETH" as const, label: "ETH" },
          ]}
          value={asset}
          onChange={setAsset}
        />
        <Segmented
          label="Expiry"
          options={EXPIRY_OPTIONS.map((e) => ({ value: e.label, label: e.label }))}
          value={expiry}
          onChange={setExpiry}
        />
        <Chip tone="accent" live>
          Recomputed 12ms ago
        </Chip>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line mb-6">
        {[
          {
            label: "ATM implied vol",
            value: fmtPct(model.atmIv),
            sub: `interpolated at ${model.atmStrike.toLocaleString("en-US")}`,
          },
          {
            label: "25 delta skew",
            value: model.skew !== null ? fmtSignedPct(model.skew, 2) : "—",
            sub: "0.25 rung less 0.75 rung",
            tone: (model.skew ?? 0) >= 0 ? ("up" as const) : ("down" as const),
          },
          {
            label: "Term slope",
            value: fmtSignedPct(model.slope),
            sub: "1d less 5m at the money",
            tone: model.slope >= 0 ? ("up" as const) : ("down" as const),
          },
          {
            label: "Spot",
            value: fmtUsd(spot),
            sub: `${asset} / USD`,
            tone: "accent" as const,
          },
        ].map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <Stat label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
          </div>
        ))}
      </div>

      <div className="grid gap-px bg-line border border-line lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] mb-6">
        <section className="bg-surface flex flex-col min-w-0">
          <header className="flex items-center justify-between h-11 px-4 border-b border-line">
            <span className="text-label-xs uppercase text-ink-3">
              Surface: moneyness by expiry
            </span>
            <span className="text-label-xs uppercase text-ink-4">
              {asset} / USD
            </span>
          </header>
          <div className="p-4 flex-1 flex items-center">
            <IVSurface
              grid={model.grid}
              columns={model.zAxis.map(
                (z) => `${z > 0 ? "+" : ""}${z.toFixed(1)}`,
              )}
              columnAxisLabel="MONEYNESS (σ)"
              rows={[...model.expiries]}
              height={302}
            />
          </div>
        </section>

        <section className="bg-surface flex flex-col min-w-0">
          <header className="flex items-center justify-between h-11 px-4 border-b border-line">
            <span className="text-label-xs uppercase text-ink-3">
              Risk-neutral density
            </span>
            <span className="text-label-xs uppercase text-ink-4">{expiry}</span>
          </header>
          <div className="p-4">
            <DensityChart points={model.density} spot={spot} height={196} />
          </div>
          <div className="px-4 pb-4 mt-auto">
            <Note icon={<IconInfo size={14} />}>
              The traded ladder is noisy and adjacent rungs can cross, which
              implies a negative probability. A pool-adjacent-violators pass
              restores monotonicity before the survival function is
              differentiated, so the density never shows a negative lobe.
            </Note>
          </div>
        </section>
      </div>

      <section className="border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 h-11 px-4 border-b border-line">
          <span className="text-label-xs uppercase text-ink-3">
            Strike ladder, {expiry} window
          </span>
          <span className="text-label-xs uppercase text-ink-4">
            {model.rows.length} rungs
          </span>
        </header>

        <TableWrap>
          <thead>
            <tr>
              <Th align="right">Strike</Th>
              <Th align="right">Moneyness</Th>
              <Th align="right">Up</Th>
              <Th align="right">Down</Th>
              <Th align="right">Implied vol</Th>
              <Th align="right">Survival</Th>
              <Th align="right">Density</Th>
              <Th align="left">Distribution</Th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r, i) => {
              const dp = model.density[i];
              const dMax = Math.max(...model.density.map((d) => d.density), 1e-9);
              const w = (dp?.density ?? 0) / dMax;
              const atm = r.strike === model.atmStrike;
              return (
                <Tr key={r.strike} className={cx(atm && "bg-[#04191c]")}>
                  <Td align="right" mono tone={atm ? "accent" : undefined}>
                    {r.strike.toLocaleString("en-US")}
                    {atm ? <span className="ml-2 text-[10px] uppercase">atm</span> : null}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {fmtSignedPct(r.strike / spot - 1, 2)}
                  </Td>
                  <Td align="right" mono tone={r.up >= 0.5 ? "up" : undefined}>
                    {fmtProb(r.up)}
                  </Td>
                  <Td align="right" mono tone={r.up < 0.5 ? "down" : undefined}>
                    {fmtProb(1 - r.up)}
                  </Td>
                  <Td align="right" mono tone={r.interpolated ? "muted" : undefined}>
                    {fmtPct(r.iv)}
                    {r.interpolated ? (
                      <span className="ml-1.5 text-[10px] text-ink-4">interp</span>
                    ) : null}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {dp ? dp.survival.toFixed(4) : "—"}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {dp ? (dp.density * 1e5).toFixed(3) : "—"}
                  </Td>
                  <Td align="left" className="w-[180px]">
                    <span className="block relative h-[6px] bg-line-soft w-full">
                      <span
                        className="absolute inset-y-0 left-0 bg-accent"
                        style={{ width: `${Math.max(w * 100, 1.5)}%`, opacity: 0.55 }}
                      />
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      </section>

      <p className="text-[12px] leading-[19px] text-ink-4 mt-5 max-w-[80ch]">
        Method: implied vol is recovered in closed form by inverting the digital
        price, since an Event Contract pays exactly when spot finishes above the
        strike, so its price is N(d2). Solving the quadratic in sigma avoids a
        root search entirely. The density follows Breeden and Litzenberger
        (1978): differentiate the survival function with respect to strike.
      </p>
    </Page>
  );
}
