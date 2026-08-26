import "server-only";

/**
 * Settlement — collecting winnings, which nothing else does for you.
 *
 * A settled Event Contract pays out only when asked. The position does not
 * decay into collateral on its own: it sits there. A wallet that trades for a
 * week and never redeems has its balance spread across dozens of finalised
 * markets while reading near zero.
 *
 * THE TRAP (bot-kit gotcha 11): `loadMarkets()` deliberately EXCLUDES finalized
 * markets, so a redeem-by-scan built on the registry silently finds nothing to
 * claim — on precisely the markets you need to claim from. Worse, the unified
 * `exchange.redeem()` resolves its ref through that same registry, so it throws
 * "unknown market ref" on every finalized market. Both were reproduced here.
 *
 * The path that works, and was proven end to end:
 *   listBinaryMarkets({ status: "Finalized" })   the list the registry hides
 *   getMarketOnchain(marketId)                   authoritative resolution state
 *   getOutcomeBalance(outcomeToken, account, id) real ERC-6909 holdings
 *   trader.redeem({ ..., outcomeIdx })           RAW tier, explicit outcome
 *
 * Verified: 1 YES on 0x…9c7a redeemed in tx
 * 0x1b21a41150cd019ca1fdc1472f416563de7e3a6158499e4b1844aa0cfc793206
 * (block 471513467), tUSDC 499.114000 -> 500.114000.
 */

import type { Hex } from "viem";
import { COLLATERAL, resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { signingExchange, rpc, signerAddress } from "./execution";

export interface ClaimableRow {
  marketId: string;
  asset: string | null;
  /** 0 = YES, 1 = NO. */
  outcomeIdx: 0 | 1;
  outcomeLabel: "YES" | "NO";
  /** Raw ERC-6909 units. */
  raw: string;
  /** Human contracts. */
  contracts: number;
  resolved: boolean;
  voided: boolean;
  marketAddress: string;
  outcomeToken: string;
  /** Settlement fee in bps. The winner is paid 1 - fee, never 1. */
  settlementFeeBps: number;
  /**
   * What redeeming actually returns, in collateral.
   *
   * A winner does NOT redeem 1:1 — the venue skims a one-time settlement fee at
   * finalize. A voided market pays BOTH sides half. Showing the face value here
   * would overstate every claim on the page.
   */
  estimatedPayout: number;
}

export interface ClaimResult {
  marketId: string;
  outcomeIdx: number;
  contracts: number;
  txHash: string | null;
  /** Chain-verified, never the SDK's word. */
  status: "VERIFIED_EXECUTED" | "VERIFIED_FAILED" | "UNKNOWN";
  blockNumber: number | null;
  collateralDelta: number | null;
  evidence: string[];
}

/**
 * Scan recently settled markets for anything this wallet can still claim.
 *
 * `scan` bounds the work: settled markets accumulate without limit, so a full
 * sweep would grow unbounded. The bot-kit defaults to 25 for the same reason.
 */
export async function findClaimable(
  scan = 25,
  config: VenueConfig = resolveVenueConfig(),
): Promise<ClaimableRow[]> {
  const ex = signingExchange(config);
  const account = await signerAddress(config);
  if (!ex || !account) return [];

  const client = (ex as unknown as { client: Record<string, unknown> }).client;
  const rows = (await (
    client.listBinaryMarkets as unknown as (o: unknown) => Promise<Record<string, unknown>[]>
  )({ status: "Finalized", limit: scan })) ?? [];

  const out: ClaimableRow[] = [];

  for (const row of rows) {
    const marketId = String(row.marketId ?? row.id ?? "");
    if (!marketId) continue;

    const oc = (await (
      client.getMarketOnchain as unknown as (id: Hex) => Promise<Record<string, unknown>>
    )(marketId as Hex).catch(() => null)) as Record<string, unknown> | null;
    if (!oc) continue;

    const resolved = oc.isResolved === true;
    const voided = oc.isVoided === true;
    if (!resolved && !voided) continue;

    const getBal = client.getOutcomeBalance as unknown as (p: {
      outcomeToken: string;
      account: string;
      id: bigint;
    }) => Promise<bigint>;

    const [yes, no] = await Promise.all([
      getBal({ outcomeToken: String(oc.outcomeToken), account, id: oc.yesId as bigint }).catch(() => 0n),
      getBal({ outcomeToken: String(oc.outcomeToken), account, id: oc.noId as bigint }).catch(() => 0n),
    ]);

    // A resolution pays only the winner. A VOID pays BOTH sides 0.5, and has no
    // winning outcome to infer — which is exactly why the outcome index must be
    // explicit rather than derived.
    const candidates: (0 | 1)[] = voided ? [0, 1] : [Number(oc.winningOutcome) as 0 | 1];
    const decimals = Number(oc.decimals ?? COLLATERAL.decimals);

    // The fee is frozen at finalize and lives on the settlement record; the
    // pool cannot be asked because it may already be serving a different
    // market (pools are recycled across windows).
    let feeBps = 0;
    try {
      const fees = (await (
        client.getMarketFees as unknown as (id: string) => Promise<Record<string, unknown> | null>
      )(marketId)) ?? null;
      if (fees?.settlementFeeBps != null) feeBps = Number(fees.settlementFeeBps);
    } catch {
      feeBps = 0;
    }

    for (const idx of candidates) {
      const held = idx === 0 ? BigInt(yes) : BigInt(no);
      if (held === 0n) continue;
      // estPayoutFor's rule, applied in integer bps:
      //   winner -> amount * (10000 - fee) / 10000 ; voided -> amount / 2
      const payoutRaw = voided
        ? held / 2n
        : (held * BigInt(10_000 - feeBps)) / 10_000n;
      out.push({
        settlementFeeBps: feeBps,
        estimatedPayout: Number(payoutRaw) / 10 ** decimals,
        marketId,
        asset: typeof row.asset === "string" ? row.asset : null,
        outcomeIdx: idx,
        outcomeLabel: idx === 0 ? "YES" : "NO",
        raw: held.toString(),
        contracts: Number(held) / 10 ** decimals,
        resolved,
        voided,
        marketAddress: String(oc.marketAddress),
        outcomeToken: String(oc.outcomeToken),
      });
    }
  }

  return out;
}

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
 * Redeem one claimable holding, then verify it from chain state.
 *
 * Goes through the RAW trader with an explicit `outcomeIdx`. The unified
 * `redeem()` cannot be used: it resolves its ref through the registry, which
 * excludes the finalized markets this function exists to claim from.
 */
export async function claim(
  row: ClaimableRow,
  config: VenueConfig = resolveVenueConfig(),
): Promise<ClaimResult> {
  const evidence: string[] = [];
  const base: Omit<ClaimResult, "status" | "txHash" | "blockNumber" | "collateralDelta"> = {
    marketId: row.marketId,
    outcomeIdx: row.outcomeIdx,
    contracts: row.contracts,
    evidence,
  };

  const ex = signingExchange(config);
  const account = await signerAddress(config);
  if (!ex || !account) {
    return { ...base, status: "UNKNOWN", txHash: null, blockNumber: null, collateralDelta: null, evidence: ["no signer configured"] };
  }
  if (config.dryRun) {
    return { ...base, status: "UNKNOWN", txHash: null, blockNumber: null, collateralDelta: null, evidence: ["PRISM_DRY_RUN is true"] };
  }

  const client = rpc(config);
  const readCollateral = () =>
    client.readContract({
      address: COLLATERAL.address as Hex,
      abi: ERC20_BALANCE_OF,
      functionName: "balanceOf",
      args: [account as Hex],
    }) as Promise<bigint>;

  const before = await readCollateral().catch(() => null);

  let txHash: string | null = null;
  try {
    const trader = (ex as unknown as { trader: { redeem: (p: unknown) => Promise<unknown> } }).trader;
    const res = (await trader.redeem({
      marketId: row.marketId as Hex,
      market: row.marketAddress,
      outcomeToken: row.outcomeToken,
      outcomeIdx: row.outcomeIdx,
      amount: BigInt(row.raw),
    })) as Record<string, unknown>;
    txHash = typeof res.hash === "string" ? res.hash : null;
    evidence.push(`trader.redeem returned hash ${txHash ? "yes" : "no"} (not trusted)`);
  } catch (e) {
    evidence.push(`redeem threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`);
  }

  // ---- verification, from chain, never from the SDK's response
  let blockNumber: number | null = null;
  let status: ClaimResult["status"] = "UNKNOWN";

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
    // Collateral actually arriving is the strongest possible confirmation: it
    // is the thing the whole operation exists to produce.
    if (status === "UNKNOWN" && collateralDelta > 0) status = "VERIFIED_EXECUTED";
  }

  return { ...base, status, txHash, blockNumber, collateralDelta, evidence };
}
