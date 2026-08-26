"use client";

/**
 * The decision panel.
 *
 * Hierarchy is deliberate: DECISION → RISK → MARKET → TECHNICAL. The previous
 * version led with slippage, liquidity and breakevens — real numbers in the
 * wrong order, so the thing a trader actually decides was buried under
 * diagnostics.
 *
 * Size is bounded by the book, not by an arbitrary number the user types. MAX
 * means "the most this book can fill", so it is impossible to walk into a 60%
 * slippage quote and only be told afterwards.
 */

import { useMemo, useState, useTransition } from "react";
import { Button, Chip, Note, cx } from "@/components/ui";
import { IconArrowOut, IconBolt, IconCheck, IconCross, IconInfo } from "@/components/icons";
import type { EventMarket, Outcome } from "@sdk/venue/types";
import { COLLATERAL, VENUE_CONFIG } from "@sdk/venue/config";
import type { BookSide } from "./page";
import type { ExpiryPhase } from "./use-countdown";
import { useSendTransaction } from "wagmi";
import { useSelfCustody } from "@/components/connect";
import { WalletBalance, useWalletFunds } from "@/components/wallet-balance";
import { executeOrder, prepareForWallet, type ExecutionReport } from "./actions";

const UNIT = COLLATERAL.symbol;
const EXPLORER = VENUE_CONFIG.explorer;

export function ExecutePanel({
  market,
  side,
  outcome,
  onOutcome,
  phase,
  left,
  structure,
}: {
  market: EventMarket;
  side: BookSide;
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  phase: ExpiryPhase;
  left: number;
  structure: string;
}) {
  const price = side.best;
  const maxFillable = Math.floor(side.depth);
  const [amount, setAmount] = useState(1);
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [pending, start] = useTransition();

  // Non-custodial path. When a wallet is connected the user signs from their
  // own address, so there is no shared nonce and no global throughput ceiling.
  const { canSign, address } = useSelfCustody();
  const funds = useWalletFunds();
  const { sendTransactionAsync } = useSendTransaction();
  const [selfState, setSelfState] = useState<string | null>(null);
  const [selfHash, setSelfHash] = useState<string | null>(null);
  const [selfError, setSelfError] = useState<string | null>(null);

  const runSelfCustody = () => {
    setSelfError(null);
    setSelfHash(null);
    start(async () => {
      setSelfState("Preparing");
      const prep = await prepareForWallet({ marketId: market.marketId, outcome, amount });
      if (!prep.ok) {
        setSelfError(`${prep.reason}: ${prep.detail}`);
        setSelfState(null);
        return;
      }
      try {
        // The SDK returns the approval but never sends it. Skipping it reverts
        // on-chain, so it goes first and is awaited before the order.
        if (prep.approval) {
          setSelfState("Approving collateral");
          await sendTransactionAsync({
            to: prep.approval.to as `0x${string}`,
            data: prep.approval.data as `0x${string}`,
            value: BigInt(prep.approval.value),
          });
        }
        setSelfState("Signing order");
        const hash = await sendTransactionAsync({
          to: prep.order.to as `0x${string}`,
          data: prep.order.data as `0x${string}`,
          value: BigInt(prep.order.value),
        });
        setSelfHash(hash);
        setSelfState("Submitted");
      } catch (e) {
        setSelfError(e instanceof Error ? e.message.slice(0, 180) : String(e));
        setSelfState(null);
      }
    });
  };

  /** Everything a binary needs — no model, just the strike and the book price. */
  const quote = useMemo(() => {
    if (price === null || amount <= 0) return null;
    const cost = amount * price;
    const payout = amount; // settles at 1 per contract
    return {
      cost,
      payout,
      maxLoss: cost,
      profit: payout - cost,
      returnPct: cost > 0 ? payout / cost - 1 : 0,
      fillable: maxFillable >= amount,
    };
  }, [price, amount, maxFillable]);

  const blocked =
    phase === "expired" || phase === "imminent" || price === null || market.strike === null;

  const run = () => {
    setReport(null);
    start(async () => {
      setReport(
        await executeOrder({
          marketId: market.marketId,
          outcome,
          side: "buy",
          amount,
        }),
      );
    });
  };

  const v = report?.verification;
  const busy = pending;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ---------- DECISION ---------- */}
      <div>
        <p className="text-label-xs uppercase text-ink-3 mb-2">Your trade</p>
        <div className="grid grid-cols-2 gap-px bg-line border border-line">
          {(["YES", "NO"] as Outcome[]).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={o === outcome}
              disabled={busy}
              onClick={() => onOutcome(o)}
              className={cx(
                "h-10 text-[13px] uppercase tracking-[0.05em] transition-colors disabled:opacity-50",
                o === outcome
                  ? o === "YES"
                    ? "bg-[#06251a] text-up"
                    : "bg-[#250d0d] text-down"
                  : "bg-surface text-ink-3 hover:text-ink hover:bg-surface-2",
              )}
            >
              {market.asset} {o === "YES" ? "up" : "down"}
            </button>
          ))}
        </div>
      </div>

      <SizeField
        amount={amount}
        onAmount={setAmount}
        max={maxFillable}
        min={market.minAmount}
        disabled={busy || price === null}
      />

      {quote ? (
        <>
          <dl className="border border-line">
            <Row k="You pay" v={`${quote.cost.toFixed(4)} ${UNIT}`} tone="ink" strong />
            <Row k="Max payout" v={`${quote.payout.toFixed(4)} ${UNIT}`} tone="accent" strong />
            <Row k="Max loss" v={`${quote.maxLoss.toFixed(4)} ${UNIT}`} tone="down" />
            <Row
              k="Potential return"
              v={`${quote.returnPct >= 0 ? "+" : ""}${(quote.returnPct * 100).toFixed(1)}%`}
              tone={quote.returnPct >= 0 ? "up" : "down"}
              strong
            />
          </dl>

          {/* A return quoted alone is misleading: +1566% IS the correct figure
              for a 6c contract, and it is exactly what a 6% chance costs. The
              market's own implied probability belongs next to it. */}
          <div className="flex items-center justify-between gap-3 border border-line px-3 py-2 -mt-4">
            <span className="text-[11px] text-ink-3">Market-implied chance</span>
            <span className="flex items-center gap-2 min-w-0">
              <span className="relative block h-[5px] w-[70px] bg-line-soft shrink-0">
                <span
                  className="absolute inset-y-0 left-0 bg-accent"
                  style={{ width: `${Math.min(100, (price ?? 0) * 100)}%` }}
                />
              </span>
              <span className="num text-[12px] text-ink-2">
                {((price ?? 0) * 100).toFixed(1)}%
              </span>
            </span>
          </div>
        </>
      ) : (
        <Note tone="neutral" icon={<IconInfo size={14} />}>
          {price === null ? (
            <>
              Nothing is offered on {outcome} right now, so there is nothing to
              buy.{" "}
              <button
                type="button"
                onClick={() => onOutcome(outcome === "YES" ? "NO" : "YES")}
                className="text-accent hover:text-ink transition-colors underline-offset-2"
              >
                Check {outcome === "YES" ? "NO" : "YES"}
              </button>{" "}
              — books here are often one-sided.
            </>
          ) : (
            "Enter a size to see the quote."
          )}
        </Note>
      )}

      {funds.connected ? <WalletBalance /> : null}

      {canSign && funds.canTrade ? (
        <p className="text-[11px] text-ink-4 text-center -mb-1">
          Signing as{" "}
          <span className="num text-ink-3">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </span>{" "}
          — your key, your funds
        </p>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        block
        leading={<IconBolt size={15} />}
        disabled={
          blocked ||
          busy ||
          !quote ||
          !quote.fillable ||
          // A connected wallet with no funds cannot sign a valid order. Block
          // here rather than letting the wallet pop and fail.
          (canSign && !funds.canTrade)
        }
        onClick={canSign ? runSelfCustody : run}
      >
        {busy
          ? (selfState ?? "Submitting…")
          : phase === "expired"
            ? "Market expired"
            : phase === "imminent"
              ? "Too close to expiry"
              : canSign && funds.blocker === "NO_COLLATERAL"
                ? "No tUSDC in wallet"
                : canSign && funds.blocker === "NO_GAS"
                  ? "No STT for gas"
                  : `Buy ${outcome}`}
      </Button>

      {phase === "imminent" && !busy ? (
        <p className="text-[11px] text-ink-4 text-center">
          {left}s left — an order would likely lock before it lands.
        </p>
      ) : null}

      {busy ? (
        <Note tone="accent" icon={<IconBolt size={14} />}>
          Signing, submitting, then verifying against chain state. The SDK
          response alone does not decide the outcome.
        </Note>
      ) : null}

      {selfError && !busy ? (
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">Wallet execution failed</span>
          <span className="block mt-1 text-ink-3">{selfError}</span>
        </Note>
      ) : null}

      {selfHash && !busy ? (
        <div className="border border-[#124c31] bg-[#04160e] p-3">
          <span className="inline-flex items-center gap-2">
            <IconCheck size={14} className="text-up" />
            <span className="text-label-xs uppercase text-ink">Signed and broadcast</span>
          </span>
          <p className="num text-[11px] text-ink-2 mt-2 break-all">{selfHash}</p>
          <p className="text-[11px] text-ink-4 mt-1.5">
            Broadcast from your wallet. Confirmation is the chain&apos;s to give —
            verify it on the explorer.
          </p>
          <a
            href={`${EXPLORER}/tx/${selfHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
          >
            Verify on explorer
            <IconArrowOut size={13} />
          </a>
        </div>
      ) : null}

      {report && !busy ? <Result report={report} /> : null}

      {/* ---------- MARKET CONDITIONS ---------- */}
      <details className="border border-line mt-auto">
        <summary className="h-9 px-3 flex items-center text-label-xs uppercase text-ink-3 cursor-pointer select-none hover:text-ink">
          Market conditions
        </summary>
        <div className="border-t border-line px-3 py-1">
          <Row k="Best offer" v={price !== null ? price.toFixed(3) : "—"} />
          <Row k="Depth" v={`${maxFillable} contracts`} />
          <Row k="Levels" v={String(side.levels.length)} />
          <Row k="Structure" v={structure} />
        </div>
      </details>

      <details className="border border-line">
        <summary className="h-9 px-3 flex items-center text-label-xs uppercase text-ink-3 cursor-pointer select-none hover:text-ink">
          Advanced
        </summary>
        <div className="border-t border-line px-3 py-1">
          <Row k="Market id" v={`${market.marketId.slice(0, 10)}…${market.marketId.slice(-4)}`} />
          <Row k="Venue" v={market.venueId ? `${market.venueId.slice(0, 8)}…` : "—"} />
          <Row k="Collateral" v={`${market.quoteDecimals}dp`} />
          <Row k="Min size" v={String(market.minAmount)} />
          <Row k="Multi-leg" v="Not implemented" />
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SizeField({
  amount,
  onAmount,
  max,
  min,
  disabled,
}: {
  amount: number;
  onAmount: (n: number) => void;
  max: number;
  min: number;
  disabled: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (amount / max) * 100) : 0;
  const over = amount > max;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-label-xs uppercase text-ink-3">Size</span>
        <button
          type="button"
          disabled={disabled || max <= 0}
          onClick={() => onAmount(max)}
          className="text-[11px] uppercase tracking-[0.05em] text-ink-3 hover:text-accent transition-colors disabled:text-ink-4"
        >
          Max {max}
        </button>
      </div>

      <div
        className={cx(
          "flex items-stretch border transition-colors",
          over ? "border-[#4a1c1c]" : "border-line focus-within:border-accent",
        )}
      >
        <input
          type="number"
          min={min}
          max={max || undefined}
          step={min}
          value={amount}
          disabled={disabled}
          onChange={(e) => onAmount(Math.max(0, Number(e.target.value) || 0))}
          aria-label="Contracts"
          className="num flex-1 min-w-0 h-9 bg-base px-2.5 text-[13px] text-ink outline-none disabled:opacity-50"
        />
        <span className="flex items-center px-2.5 border-l border-line text-label-xs uppercase text-ink-4">
          contracts
        </span>
      </div>

      {/* Fill against the real book, so an unfillable size is obvious here
          rather than in a warning after the quote. */}
      <div className="mt-2 flex items-center gap-2.5">
        <span className="relative block h-[5px] flex-1 bg-line-soft">
          <span
            className={cx("absolute inset-y-0 left-0", over ? "bg-down" : "bg-accent")}
            style={{ width: `${over ? 100 : pct}%` }}
          />
        </span>
        <span className={cx("num text-[11px] shrink-0", over ? "text-down" : "text-ink-4")}>
          {max > 0 ? `${Math.round(pct)}%` : "no depth"}
        </span>
      </div>

      {over ? (
        <p className="text-[11px] text-down mt-1.5">
          Book holds {max} contracts. Larger orders cannot fill here.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  k,
  v,
  tone,
  strong,
}: {
  k: string;
  v: string;
  tone?: "ink" | "up" | "down" | "accent";
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-line-soft last:border-b-0">
      <span className="text-[12px] text-ink-3">{k}</span>
      <span
        className={cx(
          "num text-right",
          strong ? "text-[14px]" : "text-[12px]",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "accent" && "text-accent",
          (!tone || tone === "ink") && "text-ink",
        )}
      >
        {v}
      </span>
    </div>
  );
}

function Result({ report }: { report: ExecutionReport }) {
  if (report.phase === "VALIDATION_FAILED" || report.phase === "NO_SIGNER") {
    return (
      <Note tone="warn" icon={<IconInfo size={14} />}>
        <span className="font-medium text-ink">{report.validation?.reason}</span>
        <span className="block mt-1 text-ink-3">{report.validation?.detail}</span>
      </Note>
    );
  }

  const v = report.verification;
  if (!v) return null;

  const ok = v.status === "VERIFIED_EXECUTED";
  const bad = v.status === "VERIFIED_FAILED";

  return (
    <div
      className={cx(
        "border p-3",
        ok ? "border-[#124c31] bg-[#04160e]" : bad ? "border-[#4a1c1c] bg-[#1a0a0a]" : "border-[#4d3b17] bg-[#1a1408]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          <span className={ok ? "text-up" : bad ? "text-down" : "text-warn"}>
            {ok ? <IconCheck size={14} /> : bad ? <IconCross size={14} /> : <IconInfo size={14} />}
          </span>
          <span className="text-label-xs uppercase text-ink">
            {v.status.replace(/_/g, " ")}
          </span>
        </span>
        <span className="num text-[11px] text-ink-4">{report.elapsedMs}ms</span>
      </div>

      {ok ? (
        <p className="num text-[11px] text-ink-2 mt-2">
          block {v.blockNumber.toLocaleString("en-US")} · filled {v.filled ?? "—"}
        </p>
      ) : (
        <p className="text-[12px] leading-[17px] text-ink-2 mt-2">
          {"reason" in v ? v.reason : "Awaiting a receipt."}
        </p>
      )}

      {v.evidence.length ? (
        <ul className="mt-2 pt-2 border-t border-line-soft flex flex-col gap-0.5">
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
          className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
        >
          View on explorer
          <IconArrowOut size={13} />
        </a>
      ) : null}
    </div>
  );
}
