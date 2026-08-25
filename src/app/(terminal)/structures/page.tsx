import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import { Button, Chip, PageHead, cx } from "@/components/ui";
import { IconArrowRight, IconLayers } from "@/components/icons";
import { depthMapFor, ladderFor, PRESETS, SPOT } from "@/lib/data";
import { fmtUsd, payoffCurve, replicate, fmtSignedPct } from "@/lib/quant";

export const metadata: Metadata = { title: "Structures — PRISM" };

export default function StructuresPage() {
  const built = PRESETS.map((p) => {
    const ladder = ladderFor(p.asset, p.expiry);
    const rep = replicate({
      kind: p.kind,
      ladder,
      lower: p.lower,
      upper: p.upper,
      size: 100,
      depthByStrike: depthMapFor(p.asset, p.expiry),
    });
    const lo = ladder[0].strike;
    const hi = ladder[ladder.length - 1].strike;
    const curve = payoffCurve(rep.legs, rep.cost, lo, hi, 96);
    return { preset: p, rep, curve, lo, hi };
  });

  return (
    <Page>
      <PageHead
        title="Structures"
        lede="Each preset is a solved leg set, not a template. Open one and the router re-prices it against the live ladder before anything is signed."
      >
        <Link href="/trade">
          <Button variant="primary" size="md" trailing={<IconArrowRight size={15} />}>
            Build custom
          </Button>
        </Link>
      </PageHead>

      {/* One grid, equal-height cards, every role on a shared baseline:
          title row, blurb block of reserved height, figures row, action
          anchored to the bottom of every card regardless of copy length. */}
      <div className="grid gap-px bg-line border border-line sm:grid-cols-2 xl:grid-cols-4">
        {built.map(({ preset, rep, curve, lo, hi }) => (
          <article
            key={preset.id}
            className="bg-surface flex flex-col p-5 min-w-0"
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-title-sm text-ink truncate">{preset.name}</h2>
                <p className="num text-[12px] text-ink-3 mt-1 truncate">
                  {preset.subtitle}
                </p>
              </div>
              <Chip
                tone={
                  preset.risk === "Low"
                    ? "up"
                    : preset.risk === "High"
                      ? "down"
                      : "warn"
                }
              >
                {preset.risk}
              </Chip>
            </header>

            <MiniPayoff curve={curve} lo={lo} hi={hi} spot={SPOT[preset.asset].price} />

            {/* Reserved block so a longer blurb in one column can never push
                its neighbours' figures or buttons out of line. */}
            <p className="text-[12px] leading-[18px] text-ink-3 mt-4 min-h-[90px]">
              {preset.blurb}
            </p>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-soft pt-4">
              <div>
                <dt className="text-label-xs uppercase text-ink-4">Premium</dt>
                <dd className="num text-[13px] text-ink mt-1">{fmtUsd(rep.cost)}</dd>
              </div>
              <div>
                <dt className="text-label-xs uppercase text-ink-4">Max payout</dt>
                <dd className="num text-[13px] text-accent mt-1">
                  {fmtUsd(rep.maxPayout)}
                </dd>
              </div>
              <div>
                <dt className="text-label-xs uppercase text-ink-4">Return</dt>
                <dd
                  className={cx(
                    "num text-[13px] mt-1",
                    rep.potentialReturn >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {fmtSignedPct(rep.potentialReturn)}
                </dd>
              </div>
              <div>
                <dt className="text-label-xs uppercase text-ink-4">Legs</dt>
                <dd className="num text-[13px] text-ink mt-1 inline-flex items-center gap-1.5">
                  <IconLayers size={13} className="text-ink-4" />
                  {rep.legs.length}
                </dd>
              </div>
            </dl>

            <div className="mt-auto pt-5">
              <Link href="/trade" className="block">
                <Button variant="ghost" size="md" block trailing={<IconArrowRight size={15} />}>
                  Open in terminal
                </Button>
              </Link>
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}

function MiniPayoff({
  curve,
  lo,
  hi,
  spot,
}: {
  curve: { s: number; pnl: number }[];
  lo: number;
  hi: number;
  spot: number;
}) {
  const W = 260;
  const H = 74;
  // Inset the plot so no stroke sits flush against the container border.
  const IX = 6;
  const IY = 8;
  const ys = curve.map((c) => c.pnl);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const pad = (yMax - yMin) * 0.18 || 1;
  const X = (s: number) => IX + ((s - lo) / (hi - lo || 1)) * (W - IX * 2);
  const Y = (v: number) =>
    IY +
    (1 - (v - (yMin - pad)) / (yMax + pad - (yMin - pad) || 1)) * (H - IY * 2);

  const d = curve
    .map((c, i) => `${i ? "L" : "M"}${X(c.s).toFixed(1)} ${Y(c.pnl).toFixed(1)}`)
    .join("");

  return (
    <div className="mt-4 border border-line bg-base">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" aria-hidden>
        <line x1={IX} y1={Y(0)} x2={W - IX} y2={Y(0)} stroke="#2c3234" strokeWidth="1" />
        {spot >= lo && spot <= hi ? (
          <line
            x1={X(spot)}
            y1={IY}
            x2={X(spot)}
            y2={H - IY}
            stroke="#3a4143"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        ) : null}
        <path d={d} fill="none" stroke="#00f0ff" strokeWidth="1.25" strokeLinejoin="miter" />
      </svg>
    </div>
  );
}
