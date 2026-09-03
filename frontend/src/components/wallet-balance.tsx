"use client";

/**
 * The connected wallet's own funds.
 *
 * A user can connect a wallet, see a live market, press Buy — and fail, because
 * they hold no tUSDC. Nothing told them. This reads THEIR balances client-side
 * and says plainly whether they can trade, before they try.
 *
 * Read through wagmi against the user's address, not the server's. The demo
 * burner's balance is irrelevant to a connected user and showing it would be
 * actively misleading.
 */

import { useAccount, useBalance, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { cx } from "./ui";

/** tUSDC on Shannon, verified live: 6 decimals, not 18. */
export const COLLATERAL_ADDRESS = "0x70a86d8842fb63c4ad2b7cdddf530ebf1bb25d8e" as const;
export const COLLATERAL_DECIMALS = 6;
export const COLLATERAL_SYMBOL = "tUSDC";

const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface WalletFunds {
  address?: `0x${string}`;
  connected: boolean;
  /** Native STT, for gas. */
  gas: number | null;
  /** tUSDC, the collateral every position is denominated in. */
  collateral: number | null;
  loading: boolean;
  /** Can this wallet actually open a position right now? */
  canTrade: boolean;
  /** Why not, when it cannot. */
  blocker: "NOT_CONNECTED" | "NO_GAS" | "NO_COLLATERAL" | null;
}

export function useWalletFunds(): WalletFunds {
  const { address, isConnected } = useAccount();

  const gasQuery = useBalance({
    address,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const collateralQuery = useReadContract({
    address: COLLATERAL_ADDRESS,
    abi: ERC20_BALANCE_OF,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const gas = gasQuery.data ? Number(formatUnits(gasQuery.data.value, 18)) : null;
  const collateral =
    collateralQuery.data !== undefined
      ? Number(formatUnits(collateralQuery.data as bigint, COLLATERAL_DECIMALS))
      : null;

  const loading = gasQuery.isLoading || collateralQuery.isLoading;

  let blocker: WalletFunds["blocker"] = null;
  if (!isConnected) blocker = "NOT_CONNECTED";
  else if (gas !== null && gas <= 0) blocker = "NO_GAS";
  else if (collateral !== null && collateral <= 0) blocker = "NO_COLLATERAL";

  return {
    address,
    connected: isConnected,
    gas,
    collateral,
    loading,
    canTrade: isConnected && blocker === null && !loading,
    blocker,
  };
}

/* ------------------------------------------------------------------ */

const FAUCET = "https://testnet.somnia.network";

/**
 * Funds panel.
 *
 * Names the exact blocker rather than a generic "insufficient funds", because
 * needing gas and needing collateral have different fixes.
 */
export function WalletBalance({ compact = false }: { compact?: boolean }) {
  const f = useWalletFunds();

  if (!f.connected) return null;

  const fmt = (n: number | null, dp: number) =>
    n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

  if (compact) {
    return (
      <span className="inline-flex items-center gap-3 num text-[11px] text-ink-3">
        <span className={cx(f.collateral === null ? "text-ink-4" : f.collateral > 0 ? "text-ink-2" : "text-down")}>
          {fmt(f.collateral, 2)} {COLLATERAL_SYMBOL}
        </span>
        <span className={cx(f.gas === null ? "text-ink-4" : f.gas > 0 ? "text-ink-4" : "text-down")}>
          {fmt(f.gas, 3)} STT
        </span>
      </span>
    );
  }

  return (
    <div className="border border-line">
      <div className="flex items-center justify-between h-9 px-3 border-b border-line">
        <span className="text-label-xs uppercase text-ink-3">Your wallet</span>
        {/* NOT KNOWING A BALANCE IS NOT THE SAME AS THE BALANCE BEING ZERO.
            `canTrade` is false while the reads are in flight — correctly, since
            nothing should be signed against an unknown balance — but rendering
            that as "Needs funding" accuses a funded wallet of being empty for
            as long as the RPC takes. Caught live on the deployed terminal: the
            panel read NEEDS FUNDING with both rows showing "—" on a wallet
            holding 499.96 tUSDC, and settled to READY a moment later. */}
        {f.loading ? (
          <span className="text-label-xs uppercase text-ink-3">Checking…</span>
        ) : f.canTrade ? (
          <span className="text-label-xs uppercase text-up">Ready</span>
        ) : (
          <span className="text-label-xs uppercase text-warn">Needs funding</span>
        )}
      </div>

      <div className="px-3 py-1">
        {/* `?? 0` treated an unread balance as an empty one, so both rows went
            red before either had answered. A null is "not known yet". */}
        <Row
          k={`${COLLATERAL_SYMBOL} (collateral)`}
          v={fmt(f.collateral, 6)}
          bad={f.collateral !== null && f.collateral <= 0}
        />
        <Row k="STT (gas)" v={fmt(f.gas, 6)} bad={f.gas !== null && f.gas <= 0} />
      </div>

      {f.blocker && f.blocker !== "NOT_CONNECTED" ? (
        <div className="border-t border-line px-3 py-2.5">
          <p className="text-[12px] leading-[17px] text-ink-2">
            {f.blocker === "NO_GAS" ? (
              <>
                <span className="text-warn font-medium">No STT for gas.</span> Every
                transaction needs it, even when the collateral is there.
              </>
            ) : (
              <>
                <span className="text-warn font-medium">No {COLLATERAL_SYMBOL}.</span>{" "}
                Positions are collateralised in it — without a balance an order
                cannot escrow.
              </>
            )}
          </p>
          <a
            href={FAUCET}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
          >
            Somnia testnet faucet →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, v, bad }: { k: string; v: string; bad: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-line-soft last:border-b-0">
      <span className="text-[12px] text-ink-3">{k}</span>
      <span className={cx("num text-[12px]", bad ? "text-down" : "text-ink")}>{v}</span>
    </div>
  );
}
