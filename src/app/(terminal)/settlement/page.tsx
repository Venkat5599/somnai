import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { SettlementList } from "./list";
import { Chip, Note, PageHead, Stat } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { SETTLEMENTS } from "@/lib/data";
import { fmtUsd } from "@/lib/quant";

export const metadata: Metadata = { title: "Settlement — PRISM" };

export default function SettlementPage() {
  const claimable = SETTLEMENTS.filter((s) => s.status === "Finalized");
  const total = claimable.reduce((s, r) => s + r.gross, 0);

  return (
    <Page>
      <PageHead
        title="Settlement"
        lede="A settled Event Contract pays only when someone asks it to, and a finalised market drops out of the live registry. PRISM sweeps the finalised set for every leg you hold and nets the whole structure into one claim."
      >
        <Chip tone="accent">{claimable.length} ready</Chip>
      </PageHead>

      <div className="grid sm:grid-cols-3 gap-px bg-line border border-line mb-6">
        <div className="bg-surface p-4">
          <Stat label="Claimable" value={fmtUsd(total)} sub="net of all legs" tone="accent" />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Structures finalised"
            value={String(claimable.length)}
            sub="swept from the finalised registry"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Auto claim"
            value="Enabled"
            sub="sweeps every 10 minutes"
            tone="up"
            mono={false}
          />
        </div>
      </div>

      <Note icon={<IconInfo size={14} />} tone="accent">
        loadMarkets cannot find settled winnings: a finalised binary leaves the
        live list entirely. PRISM claims from listBinaryMarkets with status
        Finalized instead, and serialises the sweep inside the trading loop so
        two senders never race the same nonce.
      </Note>

      <SettlementList />

    </Page>
  );
}
