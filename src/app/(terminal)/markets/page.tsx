import type { Metadata } from "next";
import { MarketsView } from "./view";

export const metadata: Metadata = { title: "Markets — PRISM" };

export default function MarketsPage() {
  return <MarketsView />;
}
