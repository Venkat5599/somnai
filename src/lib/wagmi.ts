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

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
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
 * WalletConnect needs a project id for its relay. Without one, injected wallets
 * (MetaMask, Rabby) still work fine — only the QR flow is unavailable — so a
 * missing id degrades a feature rather than breaking the page.
 */
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "prism-terminal-local";

export const wagmiConfig = getDefaultConfig({
  appName: "PRISM",
  projectId,
  chains: [somniaShannon],
  ssr: true,
});
