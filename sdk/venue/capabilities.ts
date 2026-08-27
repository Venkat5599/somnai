/**
 * Chain capability detection.
 *
 * PRISM claimed "atomic multi-leg batching (EIP-7702) — planned" in three
 * places in the UI and twice in the docs. That claim was never checked against
 * the chain, and it turns out to be unreachable rather than merely unbuilt:
 * EIP-7702 ships in Prague, and Somnia Shannon is several forks short of it.
 *
 * A "planned" label is a promise. A probed capability is a fact. So the claim
 * is now DERIVED from chain state on every read, and the UI renders whatever
 * the chain says — including, if Somnia ships Prague tomorrow, a `true` that
 * nobody has to remember to go and edit.
 *
 * HOW THE PROBE WORKS. RPC error messages are useless here: this node answers
 * a malformed type-0x2, a type-0x4 and a nonexistent type-0x7f with the exact
 * same `invalid transaction / 0x08`, so an envelope probe cannot distinguish
 * "unsupported type" from "bad signature". Verified against a negative control.
 *
 * What IS decisive is that each fork deploys system contracts at fixed
 * addresses. If Prague's history-storage contract has no code, Prague is not
 * live, and EIP-7702 cannot be. That is a positive, checkable signal rather
 * than an inference from a silence.
 */

import type { Hex } from "viem";
import { createPublicClient, http } from "viem";
import { resolveVenueConfig, type VenueConfig } from "./config";

/**
 * System contracts deployed by the fork that introduced them. Presence of code
 * at the address is the network's own statement that the fork is live.
 */
export const FORK_MARKERS = {
  /** EIP-4788 beacon block roots. Cancun. */
  cancun: "0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02",
  /** EIP-2935 historical block hashes. Prague — the fork that carries EIP-7702. */
  prague: "0x0000F90827F1C53a10cb7A02335B175320002935",
  /** EIP-7002 execution-layer withdrawal requests. Prague. */
  pragueWithdrawals: "0x00000961Ef480Eb55e80D19ad83579A64c007002",
} as const;

export interface ChainCapabilities {
  chainId: number;
  /** EIP-7702 set-code transactions: atomic multi-call from an EOA. */
  eip7702: boolean;
  /** Cancun is live (EIP-4788 marker present). */
  cancun: boolean;
  /** Prague is live. EIP-7702 rides on this. */
  prague: boolean;
  /** Every fact the verdict was derived from, in the order it was read. */
  evidence: string[];
  checkedAt: number;
}

/**
 * Probe the chain.
 *
 * Never throws: an unreachable node yields `false` with the read failure
 * recorded as evidence. Refusing to claim a capability we could not confirm is
 * the safe direction — the cost of a wrong `false` is a disabled button, and
 * the cost of a wrong `true` is a transaction the chain rejects.
 */
export async function probeChainCapabilities(
  config: VenueConfig = resolveVenueConfig(),
): Promise<ChainCapabilities> {
  const evidence: string[] = [];
  const client = createPublicClient({ transport: http(config.rpc) });

  const hasCode = async (label: string, address: string): Promise<boolean> => {
    try {
      const code = await client.getCode({ address: address as Hex });
      const present = !!code && code !== "0x";
      evidence.push(`${label} @ ${address.slice(0, 10)}… ${present ? "present" : "absent"}`);
      return present;
    } catch (e) {
      evidence.push(
        `${label} read failed: ${e instanceof Error ? e.message.slice(0, 90) : "unknown"}`,
      );
      return false;
    }
  };

  const [cancun, prague, pragueWithdrawals] = await Promise.all([
    hasCode("EIP-4788 (Cancun)", FORK_MARKERS.cancun),
    hasCode("EIP-2935 (Prague)", FORK_MARKERS.prague),
    hasCode("EIP-7002 (Prague)", FORK_MARKERS.pragueWithdrawals),
  ]);

  // Either Prague marker is sufficient; a chain may ship one and not the other,
  // but neither exists before Prague.
  const isPrague = prague || pragueWithdrawals;
  evidence.push(
    isPrague
      ? "Prague markers found — EIP-7702 set-code transactions are available."
      : "No Prague marker — EIP-7702 does not exist on this chain.",
  );

  return {
    chainId: config.chainId,
    eip7702: isPrague,
    cancun,
    prague: isPrague,
    evidence,
    checkedAt: Date.now(),
  };
}

/**
 * Module-level memo.
 *
 * A hard fork is not a per-request event, so re-probing on every render would
 * be three RPC reads to learn something that changes once a year. The TTL keeps
 * it from being permanent for the life of a long-running daemon.
 */
const TTL_MS = 10 * 60 * 1000;
let memo: ChainCapabilities | null = null;

export async function chainCapabilities(
  config: VenueConfig = resolveVenueConfig(),
): Promise<ChainCapabilities> {
  if (memo && memo.chainId === config.chainId && Date.now() - memo.checkedAt < TTL_MS)
    return memo;
  memo = await probeChainCapabilities(config);
  return memo;
}

/** Human sentence for the UI. Says WHY, never just "planned". */
export function batchingLabel(caps: ChainCapabilities): string {
  return caps.eip7702
    ? "EIP-7702 — available on this chain"
    : `Unavailable on chain ${caps.chainId} (pre-Prague). PRISM uses verified sequential legs with unwind.`;
}
