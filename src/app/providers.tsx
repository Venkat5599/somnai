"use client";

/**
 * Client providers.
 *
 * RainbowKit is themed to PRISM rather than shipped on its defaults: the stock
 * theme is rounded, purple-accented and glassy, which would read as a bolted-on
 * widget against a 0px-radius instrument. Corners are squared, the accent is the
 * house cyan, the overlay blur is dropped.
 */

import { useState, type ReactNode } from "react";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import "@rainbow-me/rainbowkit/styles.css";

const prismTheme = darkTheme({
  accentColor: "#00f0ff",
  accentColorForeground: "#050505",
  borderRadius: "none",
  overlayBlur: "none",
  fontStack: "system",
});

export function Providers({ children }: { children: ReactNode }) {
  // One client per mount, not a module singleton: a shared client would leak
  // one user's cached queries into the next request under SSR.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={prismTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
