"use client";

/**
 * BE THE BOOK.
 *
 * This control exists at the one place the product used to dead-end. Every
 * other action in the terminal crosses a resting offer, so all of them need
 * somebody else to be quoting first; when nobody is, the only verb left was
 * "wait". A post-only order does not need a counterparty to already exist — it
 * rests, and whoever arrives next trades against it.
 *
 * It is deliberately NOT dressed up as the same thing as a buy. A rested order
 * is a maker order: it may never fill, it locks collateral as escrow while it
 * sits, and it dies with the window. All three are said here rather than
 * discovered afterwards.
 */

import { useState, useTransition } from "react";
import { Note, cx } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import type { EventMarket, Outcome } from "@sdk/venue/types";
import { restBid, type RestReport } from "./actions";

export function RestPanel({
  market,
  outcome,
  disabled,
  secondsLeft,
}: {
  market: EventMarket;
  outcome: Outcome;
  disabled: boolean;
  secondsLeft: number;
}) {
  const [price, setPrice] = useState(0.5);
  const [size, setSize] = useState(1);
  const [report, setReport] = useState<RestReport | null>(null);
  const [pending, start] = useTransition();

  const priceOk = price > 0 && price < 1;
  const payout = priceOk ? size * (1 - price) : 0;

  return (
    <div className="border border-line">
      <div className="h-9 px-3 flex items-center justify-between border-b border-line">
        <span className="text-label-xs uppercase text-ink-3">Or quote it yourself</span>
        <span className="text-label-xs uppercase text-ink-4">maker</span>
      </div>

      <div className="px-3 py-3">
        <p className="text-[12px] leading-[17px] text-ink-2 mb-3">
          Nothing is offered, so nothing can be bought. You can rest a bid
          instead — a post-only order that <span className="text-ink">adds</span>{" "}
          the offer rather than taking one, and fills if anyone sells into it
          before the window closes.
        </p>

        <div className="grid grid-cols-2 gap-px bg-line border border-line mb-3">
          <label className="bg-base px-2.5 py-2">
            <span className="block text-label-xs uppercase text-ink-3 mb-1">
              Your price
            </span>
            <input
              type="number"
              min={0.01}
              max={0.99}
              step={0.01}
              value={price}
              disabled={disabled || pending}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              aria-label="Bid probability"
              className="num w-full bg-transparent text-[13px] text-ink outline-none disabled:opacity-50"
            />
          </label>
          <label className="bg-base px-2.5 py-2">
            <span className="block text-label-xs uppercase text-ink-3 mb-1">
              Contracts
            </span>
            <input
              type="number"
              min={market.minAmount}
              step={market.minAmount}
              value={size}
              disabled={disabled || pending}
              onChange={(e) => setSize(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Contracts to rest"
              className="num w-full bg-transparent text-[13px] text-ink outline-none disabled:opacity-50"
            />
          </label>
        </div>

        <div className="text-[11px] leading-[16px] text-ink-4 mb-3">
          Escrows{" "}
          <span className="num text-ink-3">{(price * size).toFixed(4)}</span>{" "}
          tUSDC while it rests. Pays{" "}
          <span className="num text-ink-3">{payout.toFixed(4)}</span> if {outcome}{" "}
          settles true, nothing if it does not. Cancelled by the venue when the
          window closes in {Math.max(0, secondsLeft)}s.
        </div>

        <button
          type="button"
          disabled={disabled || pending || !priceOk || size <= 0}
          onClick={() =>
            start(async () => {
              setReport(
                await restBid({
                  marketId: market.marketId,
                  outcome,
                  price,
                  size,
                }),
              );
            })
          }
          className={cx(
            "w-full h-10 text-[13px] uppercase tracking-[0.05em] transition-colors",
            disabled || pending || !priceOk || size <= 0
              ? "bg-surface-2 text-ink-4 cursor-not-allowed"
              : "bg-surface-2 text-ink border border-line hover:border-accent hover:text-accent",
          )}
        >
          {pending ? "Resting…" : `Rest bid on ${outcome}`}
        </button>

        {report ? (
          <div className="mt-3">
            {report.ok ? (
              <Note tone={report.rested ? "neutral" : "accent"} icon={<IconInfo size={14} />}>
                <span className="font-medium text-ink">
                  {report.rested
                    ? "Resting on the book."
                    : `Filled immediately — ${report.filled} contracts.`}
                </span>{" "}
                {report.rested
                  ? "Nobody has taken it yet. It fills if someone sells into it, and the venue cancels it at the close."
                  : "Someone was selling at your price, so the order crossed instead of resting."}
                {report.explorerUrl ? (
                  <>
                    {" "}
                    <a
                      href={report.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="num text-accent hover:text-ink transition-colors"
                    >
                      {report.hash?.slice(0, 10)}…
                    </a>
                  </>
                ) : null}
              </Note>
            ) : (
              <Note tone="warn" icon={<IconInfo size={14} />}>
                <span className="font-medium text-ink">{report.reason}.</span>{" "}
                {report.detail}
              </Note>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
