import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

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
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="substrate antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
