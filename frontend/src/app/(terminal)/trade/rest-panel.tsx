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
 *
 * THE USER SIGNS. The first version of this called a server action that signed
 * with the operator's burner key, which would have let any visitor spend the
 * operator's collateral by clicking a button. Making is not a lesser action
 * than taking and does not get a lesser custody model — this builds an unsigned
 * call server-side and hands it to the connected wallet, exactly as the buy
 * path does.
 */

import { useState, useTransition } from "react";
import { useSendTransaction } from "wagmi";
import { Note, cx } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { useSelfCustody } from "@/components/connect";
// The chain definition, not @sdk/venue/config: that module pulls the whole SDK
// and has no business in a browser bundle. Same reason wagmi.ts redefines it.
import { somniaShannon } from "@/lib/wagmi";
import type { EventMarket, Outcome } from "@sdk/venue/types";
import { prepareRestForWallet } from "./actions";

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
  const [state, setState] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const { canSign, address } = useSelfCustody();
  const { sendTransactionAsync } = useSendTransaction();

  const priceOk = price > 0 && price < 1;
  const payout = priceOk ? size * (1 - price) : 0;
  const ready = canSign && !disabled && !pending && priceOk && size > 0;

  const run = () => {
    setError(null);
    setHash(null);
    start(async () => {
      if (!address) {
        setError("Connect a wallet first — the order is built for its address.");
        return;
      }
      setState("Preparing");
      const prep = await prepareRestForWallet({
        marketId: market.marketId,
        outcome,
        price,
        amount: size,
        owner: address,
      });
      if (!prep.ok) {
        setError(`${prep.reason}: ${prep.detail}`);
        setState(null);
        return;
      }
      try {
        // The SDK returns the approval but never sends it; skipping it reverts
        // on-chain, so it goes first and is awaited before the order.
        if (prep.approval) {
          setState("Approving collateral");
          await sendTransactionAsync({
            to: prep.approval.to as `0x${string}`,
            data: prep.approval.data as `0x${string}`,
            value: BigInt(prep.approval.value),
          });
        }
        setState("Signing order");
        const h = await sendTransactionAsync({
          to: prep.order.to as `0x${string}`,
          data: prep.order.data as `0x${string}`,
          value: BigInt(prep.order.value),
        });
        setHash(h);
        setState("Resting");
      } catch (e) {
        setError(e instanceof Error ? e.message.slice(0, 180) : String(e));
        setState(null);
      }
    });
  };

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
          disabled={!ready}
          onClick={run}
          className={cx(
            "w-full h-10 text-[13px] uppercase tracking-[0.05em] transition-colors",
            !ready
              ? "bg-surface-2 text-ink-4 cursor-not-allowed"
              : "bg-surface-2 text-ink border border-line hover:border-accent hover:text-accent",
          )}
        >
          {pending
            ? (state ?? "Working…")
            : !canSign
              ? "Connect a wallet"
              : `Rest bid on ${outcome}`}
        </button>

        {hash ? (
          <div className="mt-3">
            <Note tone="accent" icon={<IconInfo size={14} />}>
              <span className="font-medium text-ink">Signed and sent.</span> Your
              bid rests until someone sells into it or the window closes.{" "}
              <a
                href={`${somniaShannon.blockExplorers.default.url}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="num text-accent hover:text-ink transition-colors"
              >
                {hash.slice(0, 10)}…
              </a>
            </Note>
          </div>
        ) : error ? (
          <div className="mt-3">
            <Note tone="warn" icon={<IconInfo size={14} />}>
              {error}
            </Note>
          </div>
        ) : null}
      </div>
    </div>
  );
}
