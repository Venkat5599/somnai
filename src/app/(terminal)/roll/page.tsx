import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { RollView } from "./view";

export const metadata: Metadata = { title: "Roll Engine — PRISM" };

export default function RollPage() {
  return (
    <Page>
      <RollView />
    </Page>
  );
}
