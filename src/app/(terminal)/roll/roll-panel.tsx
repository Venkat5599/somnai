"use client";

/**
 * Carry a view into the next window.
 *
 * Preview is a real plan priced against the successor's book; commit re-plans
 * server-side before signing, because the successor may have been struck,
 * filled or moved in between.
 */

import { useState, useTransition } from "react";
import { Button, Chip, Note, cx } from "@/components/ui";
import { IconArrowOut, IconBolt, IconCheck, IconInfo, IconRoll } from "@/components/icons";
import { COLLATERAL, VENUE_CONFIG } from "@sdk/venue/config";
import type { Outcome } from "@sdk/venue/types";
import type { RollPlan, RollResult } from "@sdk/dreamdex/roll";
import { commitRoll, previewRoll } from "./actions";

export function RollPanel({ marketId }: { marketId: string }) {
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [size, setSize] = useState(1);
  const [plan, setPlan] = useState<RollPlan | null>(null);
  const [result, setResult] = useState<RollResult | null>(null);
  const [pending, start] = useTransition();

  const doPreview = () =>
    start(async () => {
      setResult(null);
      setPlan(await previewRoll(marketId, outcome, size));
    });

  const doCommit = () =>
    start(async () => {
      setResult(await commitRoll(marketId, outcome, size));
    });

  return (
    <div className="border border-line mt-4">
      <header className="flex items-center justify-between h-9 px-3 border-b border-line">
        <span className="inline-flex items-center gap-2 text-label-xs uppercase text-ink-3">
          <IconRoll size={12} className="text-accent" />
          Carry forward
        </span>
      </header>

      <div className="p-3 flex flex-wrap items-end gap-3">
        <div className="flex items-stretch border border-line h-8">
          {(["YES", "NO"] as Outcome[]).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={o === outcome}
              disabled={pending}
              onClick={() => { setOutcome(o); setPlan(null); setResult(null); }}
              className={cx(
                "px-3 text-[11px] uppercase tracking-[0.05em] transition-colors",
                o === outcome
                  ? o === "YES" ? "bg-[#06251a] text-up" : "bg-[#250d0d] text-down"
                  : "text-ink-3 hover:text-ink hover:bg-surface-2",
              )}
            >
              {o}
            </button>
          ))}
        </div>

        <div className="flex items-stretch border border-line h-8">
          <input
            type="number"
            min={0}
            step={1}
            value={size}
            disabled={pending}
            onChange={(e) => { setSize(Math.max(0, Number(e.target.value) || 0)); setPlan(null); }}
            aria-label="Contracts to carry"
            className="num w-[70px] h-full bg-base px-2 text-[12px] text-ink outline-none"
          />
          <span className="flex items-center px-2 border-l border-line text-label-xs uppercase text-ink-4">
            ctr
          </span>
        </div>

        <Button size="sm" variant="ghost" onClick={doPreview} disabled={pending || size <= 0}>
          {pending && !result ? "Planning…" : "Preview roll"}
        </Button>

        {plan?.ok ? (
          <Button
            size="sm"
            variant="primary"
            leading={<IconBolt size={13} />}
            onClick={doCommit}
            disabled={pending}
          >
            Commit roll
          </Button>
        ) : null}
      </div>

      {plan ? (
        <div className="px-3 pb-3">
          {plan.ok ? (
            <div className="border border-[#0b4d54] bg-[#04191c] p-2.5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 num text-[11px]">
                <span className="text-ink-3">
                  from <span className="text-ink">{plan.from?.strike?.toFixed(2) ?? "—"}</span>
                </span>
                <span className="text-ink-4">→</span>
                <span className="text-ink-3">
                  into <span className="text-ink">{plan.to?.strike?.toFixed(2) ?? "—"}</span>
                </span>
                <span className="text-ink-3">
                  at <span className="text-accent">{plan.price?.toFixed(3)}</span>
                </span>
                <span className="text-ink-3">
                  cost{" "}
                  <span className="text-ink">
                    {plan.estimatedCost?.toFixed(4)} {COLLATERAL.symbol}
                  </span>
                </span>
              </div>
              <p className="text-[11px] leading-[15px] text-ink-4 mt-2">
                The expiring leg is left to settle and collected on Settlement —
                crossing a spread to close a contract that is about to pay in
                full would burn the roll&apos;s edge.
              </p>
            </div>
          ) : (
            <Note tone="warn" icon={<IconInfo size={13} />}>
              <span className="font-medium text-ink">{plan.blocker}</span>{" "}
              <span className="text-ink-3">{plan.detail}</span>
            </Note>
          )}
        </div>
      ) : null}

      {result ? (
        <div className="px-3 pb-3">
          <div
            className={cx(
              "border p-2.5",
              result.status === "VERIFIED_EXECUTED"
                ? "border-[#124c31] bg-[#04160e]"
                : result.status === "VERIFIED_FAILED"
                  ? "border-[#4a1c1c] bg-[#1a0a0a]"
                  : "border-[#4d3b17] bg-[#1a1408]",
            )}
          >
            <span className="inline-flex items-center gap-2">
              {result.status === "VERIFIED_EXECUTED" ? (
                <IconCheck size={13} className="text-up" />
              ) : (
                <IconInfo size={13} className="text-warn" />
              )}
              <span className="text-label-xs uppercase text-ink">
                {result.status.replace(/_/g, " ")}
              </span>
              {result.filled > 0 ? (
                <span className="num text-[11px] text-ink-2">filled {result.filled}</span>
              ) : null}
            </span>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {result.evidence.map((e, i) => (
                <li key={i} className="num text-[10px] leading-[14px] text-ink-4">{e}</li>
              ))}
            </ul>
            {result.txHash ? (
              <a
                href={`${VENUE_CONFIG.explorer}/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
              >
                Verify on explorer
                <IconArrowOut size={12} />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
