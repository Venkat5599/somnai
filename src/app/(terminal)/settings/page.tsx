import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, KV, Note, PageHead } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { NETWORK } from "@/lib/data";
import { TICK, LOT } from "@/lib/venue";

export const metadata: Metadata = { title: "Settings — PRISM" };

export default function SettingsPage() {
  return (
    <Page>
      <PageHead
        title="Settings"
        lede="Execution parameters and the venue this session is bound to. Everything here is read at runtime rather than compiled in, because venue ids move."
      >
        <Chip tone="up" live>
          Connected
        </Chip>
      </PageHead>

      <div className="grid gap-px bg-line border border-line lg:grid-cols-2">
        <section className="bg-surface p-5 min-w-0">
          <h2 className="text-title-sm text-ink mb-1">Venue</h2>
          <p className="text-[12px] text-ink-3 mb-3">
            Resolved from the live market rows, not the deployment manifest.
          </p>
          <KV k="Network" v={NETWORK.chainName} />
          <KV k="Chain id" v={String(NETWORK.chainId)} />
          <KV k="Collateral" v={NETWORK.collateral} />
          <KV
            k="Venue id"
            v={`${NETWORK.venueId.slice(0, 14)}…${NETWORK.venueId.slice(-8)}`}
            tone="muted"
          />
          <KV k="RPC" v={NETWORK.rpc.replace("https://", "")} tone="muted" />
        </section>

        <section className="bg-surface p-5 min-w-0">
          <h2 className="text-title-sm text-ink mb-1">Execution</h2>
          <p className="text-[12px] text-ink-3 mb-3">
            Applied to every leg before a batch is signed.
          </p>
          <KV k="Price tick" v={TICK.toFixed(3)} />
          <KV k="Lot size" v={LOT.toFixed(0)} />
          <KV k="Slippage tolerance" v="1.00%" />
          <KV k="Batch standard" v="EIP-7702" tone="accent" />
          <KV k="Auto claim" v="On, every 10 minutes" tone="up" />
        </section>
      </div>

      <div className="mt-6">
        <Note icon={<IconInfo size={14} />} tone="accent">
          The session key signs orders, cancels and claims. Withdrawal rights are
          never delegated, so revoking the key halts every automated action
          without moving funds.
        </Note>
      </div>
    </Page>
  );
}
