import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

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
    "PRISM turns DreamDEX Event Contracts into structured payoffs. State a view; PRISM decomposes it into Up and Down legs, executes them atomically, rolls them across window succession, and settles them into one net payout.",
};

export const viewport: Viewport = {
  themeColor: "#050505",
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
        {children}
      </body>
    </html>
  );
}
