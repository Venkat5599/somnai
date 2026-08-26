import "server-only";

/**
 * On-chain proof of PRISM's own lifecycle.
 *
 * A demo must not depend on catching a live five-minute window. The venue does
 * not pre-strike successors — measured across all twelve chains for seventeen
 * minutes — so "open the app and trade" is not a reproducible demo step.
 *
 * The honest fix is NOT a screenshot or a stored success message. Every field
 * below is re-read from Somnia on each request: the receipt, its status, the
 * block, the sender, and the collateral movement decoded from the transfer log.
 * If the chain stops agreeing, this page says so.
 *
 * These are historical transactions, and the UI labels them as such. Nothing
 * here is presented as a live execution.
 */

import type { Hex } from "viem";
import { decodeEventLog, parseAbi } from "viem";
import { COLLATERAL, resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { rpc } from "./execution";

/** PRISM's own verified round trip. Hashes only — everything else is read. */
export const LIFECYCLE = {
  buy: "0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e",
  redeem: "0x1b21a41150cd019ca1fdc1472f416563de7e3a6158499e4b1844aa0cfc793206",
  wallet: "0x8DaB23C096CD074d1c06521B0D5954618611A6a6",
} as const;

const TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export interface ProofStep {
  label: string;
  hash: string;
  /** Chain says this succeeded. Null when the receipt could not be read. */
  success: boolean | null;
  blockNumber: number | null;
  from: string | null;
  to: string | null;
  gasUsed: string | null;
  /**
   * Signed collateral movement for our wallet, decoded from the ERC-20 transfer
   * logs. Negative = paid, positive = received.
   */
  collateralDelta: number | null;
  explorerUrl: string;
  error?: string;
}

export interface LifecycleProof {
  steps: ProofStep[];
  /** Net collateral across the whole round trip. */
  net: number | null;
  /** True only when every step was read AND every receipt succeeded. */
  fullyVerified: boolean;
  checkedAt: number;
  network: string;
}

/**
 * Decode how much collateral this wallet gained or lost in a transaction.
 *
 * Reads the ERC-20 Transfer logs on the collateral token rather than trusting a
 * remembered number: a transfer out is negative, a transfer in is positive.
 */
function collateralDeltaFrom(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  wallet: string,
): number | null {
  let delta = 0n;
  let seen = false;
  const me = wallet.toLowerCase();

  for (const log of logs) {
    if (log.address.toLowerCase() !== COLLATERAL.address.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({
        abi: TRANSFER_ABI,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const { from, to, value } = parsed.args as unknown as {
        from: string;
        to: string;
        value: bigint;
      };
      if (from.toLowerCase() === me) { delta -= value; seen = true; }
      if (to.toLowerCase() === me) { delta += value; seen = true; }
    } catch {
      // Not a Transfer we can decode; ignore rather than guess.
    }
  }

  return seen ? Number(delta) / 10 ** COLLATERAL.decimals : null;
}

async function readStep(
  label: string,
  hash: string,
  config: VenueConfig,
): Promise<ProofStep> {
  const explorerUrl = `${config.explorer}/tx/${hash}`;
  const base: ProofStep = {
    label,
    hash,
    success: null,
    blockNumber: null,
    from: null,
    to: null,
    gasUsed: null,
    collateralDelta: null,
    explorerUrl,
  };

  try {
    const receipt = await rpc(config).getTransactionReceipt({ hash: hash as Hex });
    return {
      ...base,
      success: receipt.status === "success",
      blockNumber: Number(receipt.blockNumber),
      from: receipt.from,
      to: receipt.to ?? null,
      gasUsed: receipt.gasUsed.toString(),
      collateralDelta: collateralDeltaFrom(
        receipt.logs as unknown as { address: string; topics: readonly string[]; data: string }[],
        LIFECYCLE.wallet,
      ),
    };
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e),
    };
  }
}

/**
 * Re-verify the full lifecycle against chain.
 *
 * Called per request. Nothing is cached, because a proof that is not re-checked
 * is just a claim.
 */
export async function verifyLifecycle(
  config: VenueConfig = resolveVenueConfig(),
): Promise<LifecycleProof> {
  const [buy, redeem] = await Promise.all([
    readStep("Open position", LIFECYCLE.buy, config),
    readStep("Redeem winnings", LIFECYCLE.redeem, config),
  ]);

  const steps = [buy, redeem];
  const deltas = steps.map((s) => s.collateralDelta).filter((d): d is number => d !== null);
  const net = deltas.length === steps.length ? deltas.reduce((a, b) => a + b, 0) : null;

  return {
    steps,
    net,
    fullyVerified: steps.every((s) => s.success === true),
    checkedAt: Date.now(),
    network: config.network,
  };
}
