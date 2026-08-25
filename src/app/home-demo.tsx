"use client";

import { useState } from "react";
import { PayoffChart } from "@/components/charts";
import { StrikeBand } from "@/components/strike-band";
import { useReplication } from "@/components/use-replication";
import { Chip, KV, Segmented, cx } from "@/components/ui";
import { depthMapFor, ladderFor, strikeAt } from "@/lib/data";
import { fmtProb, fmtUsd, fmtSignedPct } from "@/lib/quant";
import type { StructureKind } from "@/lib/quant";

const KINDS: { value: StructureKind; label: string }[] = [
  { value: "RANGE", label: "Range" },
  { value: "SPREAD", label: "Spread" },
  { value: "DIRECTIONAL", label: "Directional" },
];

export function HomeDemo() {
  const [kind, setKind] = useState<StructureKind>("RANGE");
  const [lower, setLower] = useState(() => strikeAt("BTC", "4h", -2));
  const [upper, setUpper] = useState(() => strikeAt("BTC", "4h", 2));

  const ladder = ladderFor("BTC", "4h");
  const depth = depthMapFor("BTC", "4h");
  const strikes = ladder.map((r) => r.strike);

  const rep = useReplication({
    asset: "BTC",
    expiry: "4h",
    kind,
    lower,
    upper,
    size: 100,
  });

  const single = kind === "DIRECTIONAL";

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-px bg-line border border-line">
      <div className="bg-surface p-5 sm:p-6 flex flex-col gap-6 min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={KINDS}
            value={kind}
            onChange={(k) => {
              setKind(k);
              if (k === "DIRECTIONAL") setUpper(lower);
              else if (upper <= lower)
                setUpper(strikes[Math.min(strikes.indexOf(lower) + 4, strikes.length - 1)]);
            }}
            label="Structure kind"
          />
          <Chip tone="accent">BTC / USD · 4h window</Chip>
        </div>

        <StrikeBand
          strikes={strikes}
          depth={depth}
          lower={lower}
          upper={single ? lower : upper}
          single={single}
          spot={rep.spot}
          onChange={(lo, hi) => {
            setLower(lo);
            setUpper(single ? lo : hi);
          }}
        />

        <PayoffChart
          curve={rep.curve}
          breakevens={rep.breakevens}
          spot={rep.spot}
          band={single ? undefined : [lower, upper]}
          height={260}
        />
      </div>

      <div className="bg-surface p-5 sm:p-6 flex flex-col min-w-0">
        <p className="text-label-xs uppercase text-ink-3">Resolved legs</p>

        <ul className="mt-3 flex flex-col">
          {rep.legs.map((l, i) => (
            <li
              key={`${l.strike}-${l.side}-${i}`}
              className="flex items-center justify-between gap-3 h-9 border-b border-line-soft last:border-b-0"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={cx(
                    "num text-[12px] w-[42px] shrink-0",
                    l.weight >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {l.weight >= 0 ? "+" : ""}
                  {l.weight.toFixed(0)}
                </span>
                <span className="text-[12px] text-ink-2 truncate">
                  {l.side} {l.strike.toLocaleString("en-US")}
                </span>
              </span>
              <span className="num text-[12px] text-ink-3 shrink-0">
                {fmtProb(l.price)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5">
          <KV k="Net premium" v={fmtUsd(rep.cost)} tone="accent" />
          <KV k="Max payout" v={fmtUsd(rep.maxPayout)} />
          <KV
            k="Potential return"
            v={fmtSignedPct(rep.potentialReturn)}
            tone={rep.potentialReturn >= 0 ? "up" : "down"}
          />
          <KV k="Fill against book" v={`${(rep.fillRatio * 100).toFixed(1)}%`} />
        </div>

        <p className="mt-auto pt-6 text-[11px] leading-[16px] text-ink-4">
          Prices are snapped to the venue tick grid before they reach the
          executor, so the figure shown is the figure signed.
        </p>
      </div>
    </div>
  );
}
