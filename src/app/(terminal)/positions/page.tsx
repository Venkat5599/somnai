import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import {
  Button,
  Chip,
  PageHead,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import { IconArrowOut, IconLayers } from "@/components/icons";
import { POSITIONS } from "@/lib/data";
import { fmtSigned, fmtUsd } from "@/lib/quant";

export const metadata: Metadata = { title: "Positions — PRISM" };

export default function PositionsPage() {
  const totalValue = POSITIONS.reduce((s, p) => s + p.notional, 0);
  const pnl = POSITIONS.reduce((s, p) => s + p.pnl, 0);
  const legs = POSITIONS.reduce((s, p) => s + p.legs, 0);
  const rolling = POSITIONS.filter((p) => p.status === "Rolling").length;

  return (
    <Page>
      <PageHead
        title="Your structures"
        lede="One position object per structure. The underlying legs are held together, rolled together and redeemed together, so a settled window never strands value in a market you have to hunt for."
      >
        <Link href="/trade">
          <Button variant="primary" size="md">
            New structure
          </Button>
        </Link>
      </PageHead>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line mb-6">
        <div className="bg-surface p-4">
          <Stat label="Notional" value={fmtUsd(totalValue, 0)} sub={`${POSITIONS.length} structures`} />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Unrealised P&L"
            value={fmtSigned(pnl)}
            sub="mark to ladder mid"
            tone={pnl >= 0 ? "up" : "down"}
          />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Open legs" value={String(legs)} sub="across all windows" />
        </div>
        <div className="bg-surface p-4">
          <Stat
            label="Rolling"
            value={String(rolling)}
            sub="re-striking into successor"
            tone="accent"
          />
        </div>
      </div>

      <div className="border border-line bg-surface">
        <TableWrap>
          <thead>
            <tr>
              <Th>Structure</Th>
              <Th>Market</Th>
              <Th>Strategy</Th>
              <Th align="right">Legs</Th>
              <Th align="right">Notional</Th>
              <Th align="right">Entry</Th>
              <Th align="right">Mark</Th>
              <Th align="right">P&amp;L</Th>
              <Th align="right">Expires in</Th>
              <Th align="center">Status</Th>
              <Th align="right">Open</Th>
            </tr>
          </thead>
          <tbody>
            {POSITIONS.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <span className="flex flex-col leading-tight py-1">
                    <span className="text-ink">{p.name}</span>
                    <span className="num text-[11px] text-ink-4 mt-0.5">{p.id}</span>
                  </span>
                </Td>
                <Td mono tone="muted">
                  {p.asset}
                </Td>
                <Td tone="muted">{p.strategy}</Td>
                <Td align="right" mono>
                  <span className="inline-flex items-center gap-1.5">
                    <IconLayers size={12} className="text-ink-4" />
                    {p.legs}
                  </span>
                </Td>
                <Td align="right" mono>
                  {fmtUsd(p.notional, 0)}
                </Td>
                <Td align="right" mono tone="muted">
                  {p.entry.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </Td>
                <Td align="right" mono>
                  {p.current.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </Td>
                <Td align="right" mono tone={p.pnl >= 0 ? "up" : "down"}>
                  {fmtSigned(p.pnl)}
                </Td>
                <Td align="right" mono tone={p.expiresIn === "00:00:00" ? "muted" : undefined}>
                  {p.expiresIn}
                </Td>
                <Td align="center">
                  <Chip
                    tone={
                      p.status === "Active" ? "up" : p.status === "Rolling" ? "accent" : "warn"
                    }
                    live={p.status !== "Settling"}
                  >
                    {p.status}
                  </Chip>
                </Td>
                <Td align="right">
                  <Link
                    href={p.status === "Settling" ? "/settlement" : "/trade"}
                    className={cx(
                      "inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em]",
                      "text-ink-3 hover:text-accent transition-colors",
                    )}
                  >
                    {p.status === "Settling" ? "Claim" : "Manage"}
                    <IconArrowOut size={13} />
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </Page>
  );
}
