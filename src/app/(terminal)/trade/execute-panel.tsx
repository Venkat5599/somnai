"use client";

/**
 * Real execution against DreamDEX.
 *
 * The state machine never short-circuits: SUBMITTING cannot reach EXECUTED
 * without the server's verification verdict, and UNKNOWN renders as UNKNOWN.
 * The explorer link appears only when a hash survived verification, so there is
 * no path here that can produce a link to a transaction that does not exist.
 */

import { useState, useTransition } from "react";
import { Button, Chip, Note, cx } from "@/components/ui";
import { IconArrowOut, IconBolt, IconCheck, IconCross, IconInfo } from "@/components/icons";
import type { EventMarket, Outcome } from "@/lib/venue/types";
import { executeOrder, type ExecutionReport } from "./actions";

type Phase = "IDLE" | "SUBMITTING" | "DONE";

export function ExecutePanel({
  market,
  routable,
}: {
  market: EventMarket | null;
  routable: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [amount, setAmount] = useState(1);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (!market) return;
    setPhase("SUBMITTING");
    setReport(null);
    start(async () => {
      const r = await executeOrder({
        marketId: market.marketId,
        outcome,
        side: "buy",
        amount,
      });
      setReport(r);
      setPhase("DONE");
    });
  };

  const v = report?.verification;
  const busy = pending || phase === "SUBMITTING";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-label-xs uppercase text-ink-3 mb-2">Outcome</p>
        <div className="grid grid-cols-2 gap-px bg-line border border-line">
          {(["YES", "NO"] as Outcome[]).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={o === outcome}
              onClick={() => setOutcome(o)}
              disabled={busy}
              className={cx(
                "h-9 text-[12px] uppercase tracking-[0.05em] transition-colors disabled:opacity-50",
                o === outcome
                  ? o === "YES"
                    ? "bg-[#06251a] text-up"
                    : "bg-[#250d0d] text-down"
                  : "bg-surface text-ink-3 hover:text-ink hover:bg-surface-2",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-label-xs uppercase text-ink-3 mb-2">Contracts</p>
        <div className="flex items-stretch border border-line focus-within:border-accent transition-colors">
          <input
            type="number"
            min={market?.minAmount ?? 0.001}
            step={market?.minAmount ?? 0.001}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
            aria-label="Contracts to buy"
            className="num flex-1 min-w-0 h-9 bg-base px-2.5 text-[13px] text-ink outline-none disabled:opacity-50"
          />
          <span className="flex items-center px-2.5 border-l border-line text-label-xs uppercase text-ink-4">
            min {market?.minAmount ?? "—"}
          </span>
        </div>
      </div>

      <Button
        variant="primary"
        size="lg"
        block
        leading={<IconBolt size={15} />}
        disabled={!market || !routable || busy || amount <= 0}
        onClick={run}
      >
        {busy ? "Submitting…" : `Buy ${outcome}`}
      </Button>

      {!routable && market ? (
        <p className="text-[11px] text-ink-4 text-center">
          This market is not routable — execution is disabled.
        </p>
      ) : null}

      {busy ? (
        <Note tone="accent" icon={<IconBolt size={14} />}>
          Signing and submitting, then verifying against chain state. The SDK
          response alone does not decide the outcome.
        </Note>
      ) : null}

      {/* ---- result ---- */}
      {report && !busy ? (
        report.phase === "VALIDATION_FAILED" || report.phase === "NO_SIGNER" ? (
          <Note tone="warn" icon={<IconInfo size={14} />}>
            <span className="font-medium text-ink">
              Rejected before signing — {report.validation?.reason}
            </span>
            <span className="block mt-1 text-ink-3">{report.validation?.detail}</span>
          </Note>
        ) : v ? (
          <div
            className={cx(
              "border p-3",
              v.status === "VERIFIED_EXECUTED"
                ? "border-[#124c31] bg-[#04160e]"
                : v.status === "VERIFIED_FAILED"
                  ? "border-[#4a1c1c] bg-[#1a0a0a]"
                  : "border-[#4d3b17] bg-[#1a1408]",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <span
                  className={cx(
                    v.status === "VERIFIED_EXECUTED"
                      ? "text-up"
                      : v.status === "VERIFIED_FAILED"
                        ? "text-down"
                        : "text-warn",
                  )}
                >
                  {v.status === "VERIFIED_EXECUTED" ? (
                    <IconCheck size={14} />
                  ) : v.status === "VERIFIED_FAILED" ? (
                    <IconCross size={14} />
                  ) : (
                    <IconInfo size={14} />
                  )}
                </span>
                <span className="text-label-xs uppercase text-ink">
                  {v.status.replace(/_/g, " ")}
                </span>
              </span>
              <span className="num text-[11px] text-ink-4">{report.elapsedMs}ms</span>
            </div>

            {v.status === "VERIFIED_EXECUTED" ? (
              <dl className="mt-2.5 flex flex-col gap-1.5">
                {[
                  ["Block", v.blockNumber.toLocaleString("en-US")],
                  ["Filled", v.filled != null ? String(v.filled) : "—"],
                  ["Order id", v.orderId ? `${v.orderId.slice(0, 12)}…` : "—"],
                  ["Paid", report.estimatedCost ? `~${report.estimatedCost.toFixed(4)}` : "—"],
                ].map(([k, val]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[11px] text-ink-3">{k}</dt>
                    <dd className="num text-[11px] text-ink-2">{val}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[12px] leading-[17px] text-ink-2 mt-2">
                {"reason" in v ? v.reason : "Awaiting a receipt for the submitted hash."}
              </p>
            )}

            {/* Evidence is shown verbatim so the verdict can be audited. */}
            {v.evidence.length ? (
              <ul className="mt-2.5 pt-2.5 border-t border-line-soft flex flex-col gap-1">
                {v.evidence.map((e, i) => (
                  <li key={i} className="num text-[10px] leading-[14px] text-ink-4">
                    {e}
                  </li>
                ))}
              </ul>
            ) : null}

            {report.explorerUrl ? (
              <a
                href={report.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
              >
                View on explorer
                <IconArrowOut size={13} />
              </a>
            ) : null}
          </div>
        ) : null
      ) : null}
    </div>
  );
}
