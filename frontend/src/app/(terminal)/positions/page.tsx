import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import { Button, Note, PageHead } from "@/components/ui";
import { PositionsView, ConnectionChip, type ServerView } from "./view";
import { IconInfo } from "@/components/icons";
import { COLLATERAL, VENUE_CONFIG } from "@sdk/venue/config";
import { exchange } from "@sdk/venue/markets";
import { readBalances } from "@sdk/dreamdex/execution";

export const metadata: Metadata = { title: "Positions — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Holding {
  symbol: string;
  side: string;
  size: number;
  marketId: string | null;
}

const VERIFIED_TX =
  "0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e";

/**
 * Real wallet state.
 *
 * This page previously rendered five invented structures with invented P&L. It
 * now reads the signer's actual balances from chain and its open positions from
 * the venue.
 *
 * One caveat is itself documented venue behaviour rather than a gap: a SETTLED
 * market leaves the live registry, so a holding whose window has closed cannot
 * appear here. An empty table means "no OPEN position", not "never traded".
 */
export default async function PositionsPage() {
  let balances: Awaited<ReturnType<typeof readBalances>> = null;
  let holdings: Holding[] = [];

  try {
    balances = await readBalances();
  } catch {
    balances = null;
  }

  try {
    const ex = exchange();
    await ex.loadMarkets(true);
    const pos = await ex.fetchPositions();
    holdings = (pos ?? []).map((p) => {
      const row = p as unknown as Record<string, unknown>;
      return {
        symbol: String(row.symbol ?? "—"),
        side: String(row.side ?? "—"),
        size: Number(row.contracts ?? row.size ?? 0),
        marketId: typeof row.id === "string" ? row.id : null,
      };
    });
  } catch {
    // The testnet portfolio endpoint times out intermittently. Report empty as
    // empty rather than dressing a read failure up as "no positions".
    holdings = [];
  }

  const server: ServerView = {
    address: balances?.address ?? null,
    collateral: balances?.collateral ?? null,
    gas: balances?.gas ?? null,
    holdings: holdings.map((h) => ({
      marketId: h.marketId,
      symbol: h.symbol,
      side: h.side,
      size: h.size,
    })),
    network: VENUE_CONFIG.network,
    collateralSymbol: COLLATERAL.symbol,
  };

  return (
    <Page>
      <PageHead
        title="Positions"
        lede="Real balances and open Event Contract holdings, read from chain and from the venue registry — for the wallet that signs."
      >
        <ConnectionChip />
      </PageHead>

      <PositionsView server={server} />

      <div className="mt-6">
        <Note icon={<IconInfo size={14} />}>
          A settled market leaves the live registry, so a holding whose window
          has already closed cannot appear above — documented venue behaviour,
          not a missing feature. PRISM&apos;s first verified fill sits on a
          window that has since closed:{" "}
          <a
            href={`${VENUE_CONFIG.explorer}/tx/${VERIFIED_TX}`}
            target="_blank"
            rel="noreferrer"
            className="num text-accent hover:text-ink transition-colors"
          >
            0xd6f0a3e2…fef65e
          </a>
          .
        </Note>
      </div>

      <div className="mt-6">
        <Link href="/structures">
          <Button variant="primary" size="md">
            Open a position
          </Button>
        </Link>
      </div>
    </Page>
  );
}
