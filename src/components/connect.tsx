"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { cx } from "./ui";

/**
 * Wallet connect, styled to the instrument.
 *
 * RainbowKit's own button is rounded and gradient-filled; this uses its custom
 * render so the control matches the rest of the terminal — square, hairline
 * border, one accent.
 */
export function Connect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, openAccountModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        const base =
          "inline-flex items-center gap-2 h-8 px-2.5 border text-label-xs uppercase tracking-[0.05em] transition-colors";

        if (!ready)
          return <span className={cx(base, "border-line text-ink-4")} aria-hidden />;

        if (!connected)
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className={cx(base, "border-[#0b4d54] text-accent hover:bg-[#04262a]")}
            >
              Connect wallet
            </button>
          );

        if (chain.unsupported)
          return (
            <button
              type="button"
              onClick={openChainModal}
              className={cx(base, "border-[#4a1c1c] text-down hover:bg-[#1c0d0d]")}
            >
              Wrong network
            </button>
          );

        return (
          <button
            type="button"
            onClick={openAccountModal}
            className={cx(base, "border-line text-ink hover:bg-surface-2")}
          >
            <span className="pip-live inline-block w-[5px] h-[5px] bg-up" />
            <span className="num">{account.displayName}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

/** True when the user can sign for themselves. */
export function useSelfCustody() {
  const { address, isConnected, chain } = useAccount();
  return {
    address,
    // A connected wallet on the wrong chain cannot sign a valid order.
    canSign: Boolean(isConnected && address && chain && !("unsupported" in chain && chain.unsupported)),
  };
}
