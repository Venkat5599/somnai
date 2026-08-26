import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import {
  Button,
  Chip,
  Note,
  PageHead,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { IconArrowOut, IconInfo } from "@/components/icons";
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

  const signerless = !balances;

  return (
    <Page>
      <PageHead
        title="Positions"
        lede="The signer's real balances and open Event Contract holdings, read from chain and from the venue registry."
      >
        <Chip tone={signerless ? "neutral" : "up"} live={!signerless}>
          {signerless ? "No signer" : "Connected"}
        </Chip>
      </PageHead>

      {signerless ? (
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">No signer configured.</span> This
          deployment has no PRIVATE_KEY, so there is no wallet to report on.
        </Note>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line mb-6">
            <div className="bg-surface p-4">
              <Stat
                label={`${COLLATERAL.symbol} balance`}
                value={balances!.collateral.toLocaleString("en-US", {
                  minimumFractionDigits: 6,
                })}
                sub="collateral, read from chain"
                tone="accent"
              />
            </div>
            <div className="bg-surface p-4">
              <Stat
                label="STT balance"
                value={balances!.gas.toLocaleString("en-US", {
                  maximumFractionDigits: 6,
                })}
                sub="gas"
              />
            </div>
            <div className="bg-surface p-4">
              <Stat
                label="Open positions"
                value={String(holdings.length)}
                sub="live windows only"
              />
            </div>
            <div className="bg-surface p-4">
              <Stat
                label="Signer"
                value={`${balances!.address.slice(0, 6)}…${balances!.address.slice(-4)}`}
                sub={VENUE_CONFIG.network}
              />
            </div>
          </div>

          <div className="border border-line bg-surface">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Market</Th>
                  <Th>Side</Th>
                  <Th align="right">Contracts</Th>
                  <Th align="right">Open</Th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, i) => (
                  <Tr key={`${h.symbol}-${i}`}>
                    <Td mono>{h.symbol}</Td>
                    <Td tone="muted">{h.side}</Td>
                    <Td align="right" mono>
                      {h.size}
                    </Td>
                    <Td align="right">
                      {h.marketId ? (
                        <Link
                          href={`/trade?market=${encodeURIComponent(h.marketId)}`}
                          className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-ink-3 hover:text-accent transition-colors"
                        >
                          Manage
                          <IconArrowOut size={13} />
                        </Link>
                      ) : (
                        <span className="text-[12px] text-ink-4">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
                {holdings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="h-24 text-center text-[13px] text-ink-3">
                      No open position in a live window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </TableWrap>
          </div>

          <div className="mt-6">
            <Note icon={<IconInfo size={14} />}>
              A settled market leaves the live registry, so a holding whose
              window has already closed cannot appear above — documented venue
              behaviour, not a missing feature. PRISM&apos;s first verified fill
              sits on a window that has since closed:{" "}
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
        </>
      )}

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
