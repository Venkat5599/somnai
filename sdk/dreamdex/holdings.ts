import "server-only";

/**
 * Open Event Contract holdings for ANY address.
 *
 * The venue's own `fetchPositions()` reports whichever account the exchange was
 * constructed with — the demo burner. That is the right answer when nobody has
 * connected and the wrong one the moment somebody has: a user who signs from
 * their own wallet was shown the burner's positions, an empty table, and the
 * words "The signer's real balances". Their own fill was invisible.
 *
 * Holdings are ERC-6909 balances, so they can be read for an arbitrary account
 * without a key. This walks the LIVE registry — the mirror of `findClaimable`,
 * which walks the finalized one — and asks the outcome token what that address
 * actually holds.
 */

import type { Hex } from "viem";
import { resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { signingExchange } from "./execution";
import { exchange } from "@sdk/venue/markets";
import type { EventMarket } from "@sdk/venue/types";

export interface OpenHolding {
  marketId: string;
  symbol: string;
  /** The leg held. */
  side: "YES" | "NO";
  /** Contracts, in whole units. */
  size: number;
}

/**
 * @param markets The live windows to check. Bounded by the caller because each
 *   market costs an on-chain read, and the registry carries hundreds of rows of
 *   which only a handful are ever open at once.
 */
export async function openHoldings(
  account: string,
  markets: EventMarket[],
  config: VenueConfig = resolveVenueConfig(),
): Promise<OpenHolding[]> {
  if (!account || !markets.length) return [];

  // A read-only exchange is enough — ERC-6909 balances are public. Falling back
  // to the signing one only matters when the address book differs.
  const ex = signingExchange(config) ?? exchange(config);
  const client = (ex as unknown as { client: Record<string, unknown> }).client;
  if (!client) return [];

  const getMarketOnchain = client.getMarketOnchain as unknown as
    | ((id: Hex) => Promise<Record<string, unknown>>)
    | undefined;
  const getBal = client.getOutcomeBalance as unknown as
    | ((p: { outcomeToken: string; account: string; id: bigint }) => Promise<bigint>)
    | undefined;
  if (!getMarketOnchain || !getBal) return [];

  const out: OpenHolding[] = [];

  for (const m of markets) {
    const oc = await getMarketOnchain(m.marketId as Hex).catch(() => null);
    if (!oc) continue;

    const outcomeToken = String(oc.outcomeToken ?? "");
    if (!outcomeToken) continue;

    const [yes, no] = await Promise.all([
      getBal({ outcomeToken, account, id: oc.yesId as bigint }).catch(() => 0n),
      getBal({ outcomeToken, account, id: oc.noId as bigint }).catch(() => 0n),
    ]);

    // Contracts are carried at the market's own decimals, not the collateral's.
    const decimals = Number(oc.decimals ?? m.quoteDecimals ?? 6);
    const scale = 10 ** decimals;

    if (BigInt(yes) > 0n)
      out.push({ marketId: m.marketId, symbol: m.symbol, side: "YES", size: Number(yes) / scale });
    if (BigInt(no) > 0n)
      out.push({ marketId: m.marketId, symbol: m.symbol, side: "NO", size: Number(no) / scale });
  }

  return out;
}
