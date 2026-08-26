"use client";

/**
 * Claim list.
 *
 * Claiming is a real state transition: the row reports a chain-verified verdict
 * and links the transaction. It is not a button that turns green on a timer.
 */

import { useState, useTransition } from "react";
import { Button, Chip, Note, cx } from "@/components/ui";
import { IconArrowOut, IconCheck, IconCross, IconDownload, IconInfo } from "@/components/icons";
import { COLLATERAL, VENUE_CONFIG } from "@/lib/venue/config";
import type { ClaimableRow, ClaimResult } from "@/lib/dreamdex/settlement";
import { claimOne } from "./actions";

export function ClaimList({
  rows,
  signerless,
}: {
  rows: ClaimableRow[];
  signerless: boolean;
}) {
  const [results, setResults] = useState<Record<string, ClaimResult>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, start] = useTransition();

  if (signerless) {
    return (
      <Note tone="warn" icon={<IconInfo size={14} />}>
        <span className="font-medium text-ink">No signer configured.</span> This
        deployment has no PRIVATE_KEY, so there is nothing to claim for.
      </Note>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border border-line bg-surface p-8 text-center">
        <p className="text-[13px] text-ink-3">
          Nothing claimable in the last 25 settled markets.
        </p>
        <p className="text-[12px] text-ink-4 mt-1.5">
          Outcome tokens appear here once a market you hold resolves or voids.
        </p>
      </div>
    );
  }

  const run = (r: ClaimableRow) => {
    const key = `${r.marketId}-${r.outcomeIdx}`;
    setBusyKey(key);
    start(async () => {
      const res = await claimOne(r.marketId, r.outcomeIdx);
      setResults((s) => ({ ...s, [key]: res }));
      setBusyKey(null);
    });
  };

  return (
    <div className="flex flex-col gap-px bg-line border border-line">
      {rows.map((r) => {
        const key = `${r.marketId}-${r.outcomeIdx}`;
        const res = results[key];
        const busy = busyKey === key;
        const done = res?.status === "VERIFIED_EXECUTED";

        return (
          <article key={key} className="bg-surface p-5 min-w-0">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-title-sm text-ink">
                    {r.asset ?? "Market"} · {r.outcomeLabel}
                  </h2>
                  <Chip tone={r.voided ? "warn" : "up"}>
                    {r.voided ? "Voided" : "Resolved"}
                  </Chip>
                </div>
                <p className="num text-[12px] text-ink-4 mt-2">
                  {r.marketId.slice(0, 14)}…{r.marketId.slice(-6)}
                </p>
                <p className="text-[12px] text-ink-3 mt-1">
                  {r.voided
                    ? "A void pays both sides 0.5 — no winning outcome to infer."
                    : "Winning side. Redeems for collateral."}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-label-xs uppercase text-ink-3 mb-2">Holding</p>
                <p className="num text-[17px] text-ink">
                  {r.contracts.toFixed(4)}{" "}
                  <span className="text-[12px] text-ink-3">contracts</span>
                </p>
                <p className="num text-[11px] text-ink-4 mt-1">raw {r.raw}</p>
              </div>

              <div className="flex flex-col min-w-0">
                <Button
                  variant={done ? "ghost" : "primary"}
                  size="md"
                  block
                  disabled={busy || done}
                  onClick={() => run(r)}
                  leading={done ? <IconCheck size={15} /> : <IconDownload size={15} />}
                >
                  {done ? "Claimed" : busy ? "Redeeming…" : "Claim"}
                </Button>

                {res ? (
                  <div className="mt-2.5">
                    <span
                      className={cx(
                        "inline-flex items-center gap-1.5 text-label-xs uppercase",
                        res.status === "VERIFIED_EXECUTED"
                          ? "text-up"
                          : res.status === "VERIFIED_FAILED"
                            ? "text-down"
                            : "text-warn",
                      )}
                    >
                      {res.status === "VERIFIED_EXECUTED" ? (
                        <IconCheck size={12} />
                      ) : res.status === "VERIFIED_FAILED" ? (
                        <IconCross size={12} />
                      ) : (
                        <IconInfo size={12} />
                      )}
                      {res.status.replace(/_/g, " ")}
                    </span>

                    {res.collateralDelta !== null ? (
                      <p className="num text-[11px] text-ink-2 mt-1">
                        {res.collateralDelta >= 0 ? "+" : ""}
                        {res.collateralDelta.toFixed(6)} {COLLATERAL.symbol}
                      </p>
                    ) : null}

                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {res.evidence.map((e, i) => (
                        <li key={i} className="num text-[10px] leading-[14px] text-ink-4">
                          {e}
                        </li>
                      ))}
                    </ul>

                    {res.txHash ? (
                      <a
                        href={`${VENUE_CONFIG.explorer}/tx/${res.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
                      >
                        Verify on explorer
                        <IconArrowOut size={12} />
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
