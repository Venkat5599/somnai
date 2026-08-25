import type { Metadata } from "next";
import { AnalyticsView } from "./view";

export const metadata: Metadata = { title: "Analytics — PRISM" };

export default function AnalyticsPage() {
  return <AnalyticsView />;
}
