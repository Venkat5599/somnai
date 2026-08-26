import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead, Stat } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { COLLATERAL, VENUE_CONFIG } from "@/lib/venue/config";
import { readBalances } from "@/lib/dreamdex/execution";
import { findClaimable } from "@/lib/dreamdex/settlement";
import { ClaimList } from "./list";

export const metadata: Metadata = { title: "Settlement — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROVEN_TX =
  "0x1b21a41150cd019ca1fdc1472f416563de7e3a6158499e4b1844aa0cfc793206";

export default async function SettlementPage() {
  const [balances, claimable] = await Promise.all([
    readBalances().catch(() => null),
    findClaimable(25).catch(() => []),
  ]);

  const total = claimable.reduce((n, r) => n + r.contracts, 0);

  return (
    <Page>
      <PageHead
        title="Settlement"
        lede="A settled Event Contract pays out only when asked — the position does not decay into collateral on its own. PRISM sweeps recently finalised markets for outcome tokens this wallet still holds, and redeems them."
      >
        <Chip tone={claimable.length ? "up" : "neutral"} live={claimable.length > 0}>
          {claimable.length} claimable
        </Chip>
      </PageHead>

      <Note icon={<IconInfo size={14} />} tone="accent">
        <span className="font-medium text-ink">
          `loadMarkets()` cannot find your winnings.
        </span>{" "}
        The registry deliberately excludes finalised markets, so a redeem-by-scan
        built on it silently finds nothing — on exactly the markets you need to
        claim from. The unified `redeem()` resolves through that same registry
        and fails the same way. This page sweeps{" "}
        <span className="num">listBinaryMarkets(status: Finalized)</span>, reads
        resolution off chain, and redeems through the raw tier with an explicit
        outcome index.
      </Note>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line my-6">
        <div className="bg-surface p-4">
          <Stat
            label="Claimable"
            value={total.toFixed(4)}
            sub="contracts across settled markets"
            tone={total > 0 ? "accent" : undefined}
          />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label={`${COLLATERAL.symbol} balance`}
            value={balances ? balances.collateral.toFixed(6) : "—"}
            sub="read from chain"
          />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Markets swept" value="25" sub="most recently finalised" />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Void handling"
            value="Both sides"
            sub="a void pays 0.5 each"
            mono={false}
          />
        </div>
      </div>

      <ClaimList rows={claimable} signerless={!balances} />

      <div className="mt-6">
        <Note icon={<IconInfo size={14} />}>
          The full lifecycle is proven on chain. PRISM bought 1 YES for 0.886{" "}
          {COLLATERAL.symbol}, the market resolved YES, and the winnings were
          redeemed in{" "}
          <a
            href={`${VENUE_CONFIG.explorer}/tx/${PROVEN_TX}`}
            target="_blank"
            rel="noreferrer"
            className="num text-accent hover:text-ink transition-colors"
          >
            0x1b21a411…93206
          </a>{" "}
          — {COLLATERAL.symbol} 499.114000 → 500.114000.
        </Note>
      </div>
    </Page>
  );
}
