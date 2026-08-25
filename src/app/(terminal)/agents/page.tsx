import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { AgentsView } from "./view";

export const metadata: Metadata = { title: "Agents — PRISM" };

export default function AgentsPage() {
  return (
    <Page>
      <AgentsView />
    </Page>
  );
}
