"use client";

/**
 * Wallet configuration.
 *
 * The point of this file is the trust model, not the plumbing. Until now PRISM
 * signed everything with one server-side burner: custodial, and capped at ~1
 * transaction globally because nonces are sequential. With a connected wallet
 * the user holds their own key, so there is no shared nonce and no ceiling.
 *
 * Both paths stay available and are never confused for one another:
 *   connected  -> the user signs, from their own address
 *   otherwise  -> the guarded demo burner, so a judge can still click Buy
 */

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

/**
 * Somnia Shannon.
 *
 * Defined here rather than imported from the SDK's chain export: that module is
 * server-side and pulls in the whole SDK, which has no business in a browser
 * bundle. These are the same verified endpoints.
 */
export const somniaShannon = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.infra.testnet.somnia.network"] },
  },
  blockExplorers: {
    default: { name: "Shannon Explorer", url: "https://shannon-explorer.somnia.network" },
  },
  testnet: true,
});

/**
 * WalletConnect project id — present, or genuinely absent. Never faked.
 *
 * THE BUG THIS REPLACES. `getDefaultConfig` requires a `projectId`, so the
 * previous version satisfied the signature with a made-up local-looking slug.
 * That is not a project id. Reown's relay rejected it on every single page
 * load, and the console carried a permanent
 * `[Reown Config] … 403` — an error on a healthy deployment, which is worse
 * than a missing feature, because it trains the reader to ignore the console.
 *
 * A placeholder credential is a lie told to a service that will check it. The
 * honest shape is to omit the connector entirely when there is no id: the QR
 * flow is genuinely unavailable, and nothing pretends otherwise.
 *
 * A real id is a 32-character hex string (Reown issues them as a uuid with the
 * dashes stripped). Validating the SHAPE rather than merely the presence is
 * what stops the next placeholder from reaching the relay.
 */
export const isValidWalletConnectProjectId = (v: string | undefined): boolean =>
  typeof v === "string" && /^[0-9a-fA-F]{32}$/.test(v.trim());

const rawProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
export const walletConnectProjectId = isValidWalletConnectProjectId(rawProjectId)
  ? (rawProjectId as string)
  : null;

/**
 * Wallet list, built explicitly so WalletConnect can be left out entirely.
 *
 * NOT JUST THE `walletConnectWallet` ENTRY. RainbowKit's `metaMaskWallet` and
 * `rainbowWallet` are dual-mode — they fall back to a WalletConnect relay for
 * the mobile deep-link path — so `connectorsForWallets` throws
 * `No projectId found` if either is in the list without one. The first version
 * of this fix listed them anyway and threw at module load; a unit test caught
 * it before it shipped, which is the entire reason that test exists.
 *
 * So with no id the list is `injectedWallet` alone. That is genuinely
 * credential-free: it talks to `window.ethereum` directly, so MetaMask, Rabby
 * and every other extension wallet still connect, and the page carries no relay
 * error. A real id restores the full list including the QR flow.
 */
const connectors = connectorsForWallets(
  walletConnectProjectId
    ? [
        { groupName: "Installed", wallets: [injectedWallet, metaMaskWallet, rainbowWallet] },
        { groupName: "Scan to connect", wallets: [walletConnectWallet] },
      ]
    : [{ groupName: "Installed", wallets: [injectedWallet] }],
  {
    appName: "PRISM",
    // Only reachable when the id is real: every wallet that reads this field is
    // excluded from the list above when it is not.
    projectId: walletConnectProjectId ?? "",
  },
);

export const wagmiConfig = createConfig({
  chains: [somniaShannon],
  connectors,
  transports: { [somniaShannon.id]: http() },
  ssr: true,
});
