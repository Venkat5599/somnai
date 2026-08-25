import type { Metadata } from "next";
import { TradeTerminal } from "./terminal";

export const metadata: Metadata = {
  title: "Trade — PRISM",
};

export default function TradePage() {
  return <TradeTerminal />;
}
