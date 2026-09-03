"use client";

/**
 * WHOSE POSITIONS THIS PAGE IS SHOWING IS NEVER AMBIGUOUS.
 *
 * The server can only render the demo signer, because whether a wallet is
 * connected is client state. Left there, a user who connected, signed with
 * their own key and filled an order was then shown the BURNER's address, the
 * burner's balance and an empty table — another wallet's money labelled "the
 * signer's real balances". The one page whose job is to prove a fill happened
 * was proving it against the wrong account.
 *
 * So the server's view is the FALLBACK, and it is re-read for the connected
 * address as soon as there is one. The header names which of the two is on
 * screen; it never silently swaps.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSelfCustody } from "@/components/connect";
import { Chip, Note, Stat, TableWrap, Td, Th, Tr } from "@/components/ui";
import { IconArrowOut, IconInfo } from "@/components/icons";
import { walletView, type WalletView } from "./actions";

export interface ServerView {
  address: string | null;
  collateral: number | null;
  gas: number | null;
  holdings: { marketId: string | null; symbol: string; side: string; size: number }[];
  network: string;
  collateralSymbol: string;
}

export function PositionsView({ server }: { server: ServerView }) {
  const { address, canSign } = useSelfCustody();
  const [mine, setMine] = useState<WalletView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canSign || !address) {
      setMine(null);
      return;
    }
    let live = true;
    setLoading(true);
    walletView(address)
      .then((v) => {
        if (live) setMine(v);
      })
      .catch(() => {
        if (live) setMine(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [address, canSign]);

  const self = Boolean(mine);
  const shownAddress = mine?.address ?? server.address;
  const collateral = mine ? mine.collateral : server.collateral;
  const gas = mine ? mine.gas : server.gas;
  const holdings = mine
    ? mine.holdings.map((h) => ({ ...h, marketId: h.marketId as string | null }))
    : server.holdings;

  if (!shownAddress) {
    return (
      <Note tone="warn" icon={<IconInfo size={14} />}>
        <span className="font-medium text-ink">No signer configured.</span> This
        deployment has no PRIVATE_KEY and no wallet is connected, so there is no
        account to report on.
      </Note>
    );
  }

  const fmt = (n: number | null, dp: number) =>
    n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: dp });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-ink-2">
          {self ? (
            <>
              Reading <span className="text-ink">your connected wallet</span> — the
              address that signs, and the only one whose fills are yours.
            </>
          ) : (
            <>
              No wallet connected, so this is the{" "}
              <span className="text-ink">demo signer</span>. Connect to see your
              own balances and positions.
            </>
          )}
        </p>
        {loading ? (
          <span className="text-label-xs uppercase text-ink-3">Reading…</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line mb-6">
        <div className="bg-surface p-4">
          <Stat
            label={`${server.collateralSymbol} balance`}
            value={fmt(collateral, 6)}
            sub="collateral, read from chain"
            tone="accent"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat label="STT balance" value={fmt(gas, 6)} sub="gas" />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Open positions"
            value={String(holdings.length)}
            sub="live windows only"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label={self ? "Your wallet" : "Demo signer"}
            value={`${shownAddress.slice(0, 6)}…${shownAddress.slice(-4)}`}
            sub={server.network}
          />
        </div>
      </div>

      <div className="border border-line bg-surface">
        <TableWrap>
          <thead>
            <tr>
              <Th>Market</Th>
              <Th>Side</Th>
              <Th align="right">Contracts</Th>
              <Th align="right">Open</Th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <Tr key={`${h.symbol}-${h.side}-${i}`}>
                <Td mono>{h.symbol}</Td>
                <Td tone="muted">{h.side}</Td>
                <Td align="right" mono>
                  {h.size}
                </Td>
                <Td align="right">
                  {h.marketId ? (
                    <Link
                      href={`/trade?market=${encodeURIComponent(h.marketId)}`}
                      className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-ink-3 hover:text-accent transition-colors"
                    >
                      Manage
                      <IconArrowOut size={13} />
                    </Link>
                  ) : (
                    <span className="text-[12px] text-ink-4">—</span>
                  )}
                </Td>
              </Tr>
            ))}
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={4} className="h-24 text-center text-[13px] text-ink-3">
                  {loading
                    ? "Reading open windows…"
                    : mine?.holdingsError
                      ? "Positions could not be read — that is not the same as holding none."
                      : "No open position in a live window."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>
      </div>
    </>
  );
}

export function ConnectionChip() {
  const { canSign } = useSelfCustody();
  return (
    <Chip tone={canSign ? "up" : "neutral"} live={canSign}>
      {canSign ? "Your wallet" : "Demo signer"}
    </Chip>
  );
}
