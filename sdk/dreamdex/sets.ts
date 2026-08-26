import "server-only";

/**
 * Complete sets — the primitive that makes an Event Contract two-sided.
 *
 * One unit of collateral mints one of EVERY outcome: 1 tUSDC → 1 YES + 1 NO.
 * The pair always sums to 1, which is precisely why the Up price is a
 * risk-neutral probability. Burning reverses it.
 *
 * WHY IT MATTERS PRACTICALLY: minting is how you take the side nobody is
 * offering. If the book has asks on YES but nothing on NO, you cannot buy NO —
 * but you can mint a set and sell the YES, which leaves you long NO at a price
 * you chose. It is the escape hatch from a one-sided book, and this venue's
 * books are frequently one-sided.
 *
 * LIMITATION, STATED PLAINLY: the SDK exposes `buildPlaceOrder` for unsigned
 * orders but has NO `buildMintSet`. So sets are server-signed only, on the demo
 * burner. A connected user cannot mint through PRISM until the SDK offers an
 * unsigned builder, and hand-rolling the calldata for a fund-moving call is not
 * a trade worth making.
 */

import { exchange } from "@sdk/venue/markets";
import { resolveVenueConfig, COLLATERAL, type VenueConfig } from "@sdk/venue/config";
import type { EventMarket } from "@sdk/venue/types";
import { rpc, signerAddress, signingExchange } from "./execution";
import type { Hex } from "viem";

export interface SetResult {
  ok: boolean;
  txHash: string | null;
  /** Chain-verified, never the SDK's word. */
  status: "VERIFIED_EXECUTED" | "VERIFIED_FAILED" | "UNKNOWN" | "REJECTED";
  blockNumber: number | null;
  collateralDelta: number | null;
  reason?: string;
  evidence: string[];
}

const reject = (reason: string): SetResult => ({
  ok: false,
  txHash: null,
  status: "REJECTED",
  blockNumber: null,
  collateralDelta: null,
  reason,
  evidence: [],
});

const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Mint or burn complete sets, then verify from chain.
 *
 * Both directions share this path because both are single fund-moving writes
 * whose truth must come from the receipt rather than the SDK's return value.
 */
async function runSet(
  kind: "mint" | "burn",
  market: EventMarket | null,
  amount: number,
  config: VenueConfig = resolveVenueConfig(),
): Promise<SetResult> {
  if (config.dryRun) return reject("PRISM_DRY_RUN is true — nothing is signed.");
  if (!market) return reject("That market is not in the registry.");
  if (market.status !== "Trading")
    return reject(`Status is ${market.status}; only Trading accepts sets.`);
  if (!(amount > 0)) return reject("Amount must be greater than zero.");
  if (amount < market.minAmount)
    return reject(`Venue minimum is ${market.minAmount} contracts.`);

  const ex = signingExchange(config);
  const account = await signerAddress(config);
  if (!ex || !account) return reject("No signer configured for this deployment.");

  const client = rpc(config);
  const readCollateral = () =>
    client.readContract({
      address: COLLATERAL.address as Hex,
      abi: ERC20_BALANCE_OF,
      functionName: "balanceOf",
      args: [account as Hex],
    }) as Promise<bigint>;

  const before = await readCollateral().catch(() => null);
  const evidence: string[] = [];
  let txHash: string | null = null;

  try {
    const fn = kind === "mint" ? ex.mintSet.bind(ex) : ex.burnSet.bind(ex);
    const res = (await fn(market.symbol, amount)) as Record<string, unknown>;
    txHash = typeof res.hash === "string" ? res.hash : null;
    evidence.push(`${kind}Set returned hash ${txHash ? "yes" : "no"} (not trusted)`);
  } catch (e) {
    evidence.push(`${kind} threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 150)}`);
  }

  let status: SetResult["status"] = "UNKNOWN";
  let blockNumber: number | null = null;

  if (txHash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
      blockNumber = Number(receipt.blockNumber);
      evidence.push(`receipt.status=${receipt.status} block=${blockNumber}`);
      status = receipt.status === "success" ? "VERIFIED_EXECUTED" : "VERIFIED_FAILED";
    } catch {
      evidence.push("receipt not yet available");
    }
  }

  const after = await readCollateral().catch(() => null);
  let collateralDelta: number | null = null;
  if (before !== null && after !== null) {
    collateralDelta = Number(after - before) / 10 ** COLLATERAL.decimals;
    evidence.push(`${COLLATERAL.symbol} delta ${collateralDelta.toFixed(6)}`);
    // Minting spends collateral; burning returns it. Either way a real movement
    // in the expected direction is the strongest confirmation available.
    const expected = kind === "mint" ? collateralDelta < 0 : collateralDelta > 0;
    if (status === "UNKNOWN" && expected) status = "VERIFIED_EXECUTED";
  }

  return {
    ok: status === "VERIFIED_EXECUTED",
    txHash,
    status,
    blockNumber,
    collateralDelta,
    evidence,
  };
}

/** 1 collateral → 1 of every outcome. */
export const mintSet = (m: EventMarket | null, amount: number, c?: VenueConfig) =>
  runSet("mint", m, amount, c);

/** Burn a complete set back to collateral. */
export const burnSet = (m: EventMarket | null, amount: number, c?: VenueConfig) =>
  runSet("burn", m, amount, c);

/**
 * Is minting the better route right now?
 *
 * True when the outcome the user wants has no resting offer but the opposite
 * side does — the exact case where a direct buy is impossible and mint-then-sell
 * is not.
 */
export async function shouldMint(
  market: EventMarket,
  want: "YES" | "NO",
  config: VenueConfig = resolveVenueConfig(),
): Promise<{ mintIsBetter: boolean; reason: string }> {
  const ex = exchange(config);
  const other = want === "YES" ? "NO" : "YES";

  const ask = async (o: string) => {
    try {
      const ob = await ex.fetchOrderBook(`${market.symbol}#${o}`);
      return ((ob.asks ?? []) as [number, number][])[0]?.[0] ?? null;
    } catch {
      return null;
    }
  };

  const [wantAsk, otherAsk] = await Promise.all([ask(want), ask(other)]);

  if (wantAsk === null && otherAsk !== null)
    return {
      mintIsBetter: true,
      reason: `Nothing is offered on ${want}, but ${other} has a book. Mint a set and sell the ${other} leg.`,
    };

  return {
    mintIsBetter: false,
    reason: wantAsk !== null ? `${want} is directly buyable at ${wantAsk}.` : "Neither side has a book.",
  };
}
