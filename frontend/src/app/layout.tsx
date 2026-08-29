import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";

/**
 * Type.
 *
 * Was Inter + JetBrains Mono. Both are the reflexive default — the sans that
 * sits invisibly under every product, and the mono that carries every fake code
 * block — so the identity rested on the two most-reached-for faces on the shelf.
 *
 * The replacement is a decision about what this product IS. PRISM is an
 * instrument: 0px radius, butt caps, miter joins, and screens whose entire
 * content is numbers. So the NUMERALS carry the brand. Geist Mono (SIL OFL,
 * self-hosted, real tabular figures) is the signature voice — used for data,
 * and for the hero at scale.
 *
 * Chrome — labels, prose, nav — drops to the native system stack. That is
 * genuinely neutral rather than a trendy pick, renders sharp at the 11px this
 * UI lives at, and ships no bytes. The signature is the mono; the chrome gets
 * out of its way.
 */

export const metadata: Metadata = {
  title: "PRISM — Structured Derivatives Terminal",
  description:
    "PRISM composes DreamDEX Event Contracts into structured payoffs. State a view once; PRISM decomposes it across the venue's live binary markets and carries it through window succession.",
};

export const viewport: Viewport = {
  themeColor: "#0c0b0a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <body className="substrate antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
