import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead, TableWrap, Td, Th, Tr, cx } from "@/components/ui";
import { IconArrowOut, IconInfo } from "@/components/icons";
import { VENUE_CONFIG } from "@/lib/venue/config";
import { signerAddress } from "@/lib/dreamdex/execution";
import { getHistory } from "@/lib/dreamdex/history";

export const metadata: Metadata = { title: "Activity — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The signer's real on-chain record.
 *
 * This page used to be a static array of invented rows whose hashes 404'd on
 * the explorer. It now reads the wallet's actual transactions from the Shannon
 * explorer account API — so every hash resolves, because the explorer is where
 * it came from.
 */
export default async function ActivityPage() {
  const address = await signerAddress();
  const { rows, error } = address
    ? await getHistory(address, 25)
    : { rows: [], error: null };

  return (
    <Page>
      <PageHead
        title="Audit log"
        lede="Every transaction this signer has sent, read from the Shannon explorer. Each hash resolves on-chain because that is where it was read from."
      >
        <Chip tone={rows.length ? "up" : "neutral"} live={rows.length > 0}>
          {rows.length} on-chain
        </Chip>
      </PageHead>

      {!address ? (
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">No signer configured.</span> This
          deployment has no PRIVATE_KEY, so there is no wallet history to read.
        </Note>
      ) : error ? (
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">Explorer unreachable.</span> No
          history could be read, and nothing is being substituted.
          <span className="block mt-1.5 num text-[11px] text-ink-4">{error}</span>
        </Note>
      ) : (
        <div className="border border-line bg-surface">
          <TableWrap>
            <thead>
              <tr>
                <Th align="right">Block</Th>
                <Th>Time (UTC)</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th align="right">Gas</Th>
                <Th align="center">Result</Th>
                <Th align="right">Transaction</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.hash}>
                  <Td align="right" mono tone="muted">
                    {r.blockNumber.toLocaleString("en-US")}
                  </Td>
                  <Td mono tone="muted">
                    {new Date(r.timestamp * 1000).toISOString().slice(5, 16).replace("T", " ")}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cx(
                          "w-[3px] h-[13px] shrink-0",
                          r.success ? "bg-up" : "bg-down",
                        )}
                      />
                      <span className="text-ink">{r.kind}</span>
                    </span>
                  </Td>
                  <Td mono tone="muted">
                    {r.to ? `${r.to.slice(0, 10)}…${r.to.slice(-4)}` : "—"}
                  </Td>
                  <Td align="right" mono tone="muted">
                    {r.gasUsed.toLocaleString("en-US")}
                  </Td>
                  <Td align="center">
                    <Chip tone={r.success ? "up" : "down"}>
                      {r.success ? "Success" : "Reverted"}
                    </Chip>
                  </Td>
                  <Td align="right">
                    <a
                      href={`${VENUE_CONFIG.explorer}/tx/${r.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="num inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-accent transition-colors"
                    >
                      {r.hash.slice(0, 10)}…{r.hash.slice(-6)}
                      <IconArrowOut size={12} />
                    </a>
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-24 text-center text-[13px] text-ink-3">
                    This wallet has sent no transactions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </TableWrap>

          <div className="flex flex-wrap items-center justify-between gap-3 px-3 h-11 border-t border-line">
            <span className="text-[12px] text-ink-3">
              signer {address.slice(0, 10)}…{address.slice(-6)}
            </span>
            <span className="num text-[12px] text-ink-4">
              source: {VENUE_CONFIG.explorer.replace("https://", "")}
            </span>
          </div>
        </div>
      )}
    </Page>
  );
}
