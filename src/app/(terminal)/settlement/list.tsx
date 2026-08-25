"use client";

/**
 * The claim list.
 *
 * Claiming is a real state transition here, not a button that looks live and
 * does nothing: the row moves to Claimed, the action reports the amount that
 * settled, and the control disables so it cannot be double submitted.
 */

import { useState } from "react";
import { Button, Chip, cx } from "@/components/ui";
import {
  IconCheck,
  IconCross,
  IconDownload,
  IconLock,
} from "@/components/icons";
import { SETTLEMENTS } from "@/lib/data";
import { fmtSigned, fmtUsd } from "@/lib/quant";

type ClaimState = "idle" | "claiming" | "claimed";

export function SettlementList() {
  const [state, setState] = useState<Record<string, ClaimState>>({});

  const claim = (id: string) => {
    setState((s) => ({ ...s, [id]: "claiming" }));
    // Stands in for the redeem transaction landing on the venue.
    setTimeout(
      () => setState((s) => ({ ...s, [id]: "claimed" })),
      900,
    );
  };

  return (
    <div className="mt-6 flex flex-col gap-px bg-line border border-line">
      {SETTLEMENTS.map((row) => {
        const net = row.gross - row.cost;
        const finalized = row.status === "Finalized";
        const st = state[row.id] ?? "idle";
        const claimed = st === "claimed";

        return (
          <article key={row.id} className="bg-surface p-5 min-w-0">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
              {/* identity */}
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-title-sm text-ink">{row.name}</h2>
                  <Chip
                    tone={claimed ? "accent" : finalized ? "up" : "warn"}
                    live={!finalized || st === "claiming"}
                  >
                    {claimed ? "Claimed" : st === "claiming" ? "Claiming" : row.status}
                  </Chip>
                </div>
                <p className="num text-[12px] text-ink-4 mt-2">
                  {row.id} · {row.contract}
                </p>
                <p className="text-[12px] text-ink-3 mt-1">
                  Expired {row.expiredAt}
                </p>
              </div>

              {/* legs */}
              <div className="min-w-0">
                <p className="text-label-xs uppercase text-ink-3 mb-2.5">
                  Leg results
                </p>
                <ul className="flex flex-col">
                  {row.legs.map((l, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 h-8 border-b border-line-soft last:border-b-0"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className={cx(
                            "shrink-0",
                            l.result === "ITM" ? "text-up" : "text-ink-4",
                          )}
                        >
                          {l.result === "ITM" ? (
                            <IconCheck size={13} />
                          ) : (
                            <IconCross size={13} />
                          )}
                        </span>
                        <span className="text-[12px] text-ink-2 truncate">
                          {l.label} {l.strike.toLocaleString("en-US")}
                        </span>
                      </span>
                      <span
                        className={cx(
                          "num text-[12px] shrink-0",
                          l.result === "ITM" ? "text-ink" : "text-ink-4",
                        )}
                      >
                        {l.result}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-ink-4 mt-2.5">
                  Oracle reference: Somnia price feed at window close
                </p>
              </div>

              {/* payout: figures on a shared baseline, action anchored below */}
              <div className="flex flex-col min-w-0">
                <dl className="flex flex-col">
                  <div className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="text-[12px] text-ink-3">Premium paid</dt>
                    <dd className="num text-[12px] text-ink-2">
                      {fmtUsd(row.cost)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="text-[12px] text-ink-3">Gross value</dt>
                    <dd className="num text-[12px] text-ink">
                      {fmtUsd(row.gross)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-line-soft mt-1 pt-2.5">
                    <dt className="text-[12px] text-ink-3">Net</dt>
                    <dd
                      className={cx(
                        "num text-[15px]",
                        net >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {fmtSigned(net)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-auto pt-4">
                  <Button
                    variant={finalized && !claimed ? "primary" : "ghost"}
                    size="md"
                    block
                    disabled={!finalized || st !== "idle"}
                    onClick={() => claim(row.id)}
                    leading={
                      claimed ? (
                        <IconCheck size={15} />
                      ) : finalized ? (
                        <IconDownload size={15} />
                      ) : (
                        <IconLock size={15} />
                      )
                    }
                  >
                    {claimed
                      ? `Claimed ${fmtUsd(row.gross)}`
                      : st === "claiming"
                        ? "Redeeming legs"
                        : finalized
                          ? `Claim ${fmtUsd(row.gross)}`
                          : "Awaiting resolution"}
                  </Button>
                  {claimed ? (
                    <p className="num text-[11px] text-ink-4 mt-2 text-center">
                      settled to wallet · {row.contract}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
