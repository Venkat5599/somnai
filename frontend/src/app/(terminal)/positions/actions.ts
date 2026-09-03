"use server";

/**
 * Wallet state for whoever is actually looking.
 *
 * The page cannot decide this on the server: whether a wallet is connected is
 * client state, known only after hydration. So the server renders the demo
 * signer's view — correct for a visitor who never connects — and this action
 * re-reads for the connected address once there is one.
 */

import { readBalances } from "@sdk/dreamdex/execution";
import { openHoldings, type OpenHolding } from "@sdk/dreamdex/holdings";
import { liveMarketSnapshot } from "@sdk/venue/cache";
import { isRoutable } from "@sdk/venue/types";

export interface WalletView {
  address: string;
  collateral: number;
  gas: number;
  holdings: OpenHolding[];
  /** True when this is the user's own wallet rather than the demo signer. */
  self: boolean;
  /** Set when holdings could not be read; an empty list then means nothing. */
  holdingsError: string | null;
}

/** Only ever an address — never a key, and never anything the client chose to trust. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function walletView(address: string): Promise<WalletView | null> {
  // The address comes from the browser, so it is validated as an address before
  // it is used in a chain read. It grants nothing — these are public balances —
  // but an unvalidated string has no business reaching a contract call.
  if (!ADDRESS.test(address)) return null;

  const balances = await readBalances(undefined, address).catch(() => null);
  if (!balances) return null;

  let holdings: OpenHolding[] = [];
  let holdingsError: string | null = null;
  try {
    const snap = await liveMarketSnapshot();
    // Only windows that are still open can hold an OPEN position, and each one
    // costs a chain read — so the walk is bounded to what can actually be held.
    const live = snap.all
      .filter((m) => !m.finalized && !m.voided && isRoutable(m, Date.now()))
      .slice(0, 12);
    holdings = await openHoldings(address, live);
  } catch (e) {
    // Reporting a read failure as "no positions" is the same lie the balance
    // panel used to tell. An empty table has to mean empty.
    holdingsError = e instanceof Error ? e.message.slice(0, 140) : String(e);
  }

  return {
    address: balances.address,
    collateral: balances.collateral,
    gas: balances.gas,
    holdings,
    self: true,
    holdingsError,
  };
}
