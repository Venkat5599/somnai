import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { ActivityView } from "./view";

export const metadata: Metadata = { title: "Activity — PRISM" };

export default function ActivityPage() {
  return (
    <Page>
      <ActivityView />
    </Page>
  );
}
