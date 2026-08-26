import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead, cx } from "@/components/ui";
import { IconArrowOut, IconCheck, IconCross, IconInfo } from "@/components/icons";
import { COLLATERAL } from "@sdk/venue/config";
import { verifyLifecycle } from "@sdk/dreamdex/proof";

export const metadata: Metadata = { title: "Proof — PRISM" };

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The demo's anchor.
 *
 * A live trade needs a struck, liquid, non-expiring window — and the venue does
 * not pre-strike successors, so that cannot be guaranteed at demo time. This
 * page removes the dependency WITHOUT faking anything: it re-reads PRISM's own
 * historical transactions from chain on every request and reports what the
 * chain actually says.
 *
 * It is labelled as historical throughout. Live execution still lives on
 * /trade and is unaffected.
 */
export default async function ProofPage() {
  const proof = await verifyLifecycle();

  return (
    <Page>
      <PageHead
        title="On-chain proof"
        lede="PRISM's own round trip, re-read from Somnia on every load. These are historical transactions — not a live execution — and every field below is fetched from the chain rather than stored."
      >
        <Chip tone={proof.fullyVerified ? "up" : "warn"} live={proof.fullyVerified}>
          {proof.fullyVerified ? "Verified on-chain" : "Unverified"}
        </Chip>
      </PageHead>

      <Note icon={<IconInfo size={14} />} tone="accent">
        <span className="font-medium text-ink">Nothing here is cached.</span> The
        receipt status, block, sender and collateral movement are read from
        Somnia {proof.network} each time this page renders, and the collateral
        delta is decoded from the transfer logs rather than remembered. If the
        chain stopped agreeing, this page would say so.
      </Note>

      <ol className="mt-6 flex flex-col gap-px bg-line border border-line">
        {proof.steps.map((s, i) => (
          <li key={s.hash} className="bg-surface p-5 min-w-0">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="num text-[12px] text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="text-title-sm text-ink">{s.label}</h2>
                  {s.success === true ? (
                    <Chip tone="up">
                      <IconCheck size={11} /> receipt 0x1
                    </Chip>
                  ) : s.success === false ? (
                    <Chip tone="down">
                      <IconCross size={11} /> reverted
                    </Chip>
                  ) : (
                    <Chip tone="warn">unreadable</Chip>
                  )}
                </div>

                {s.collateralDelta !== null ? (
                  <p
                    className={cx(
                      "num text-[24px] leading-[30px] mt-3",
                      s.collateralDelta >= 0 ? "text-up" : "text-ink",
                    )}
                  >
                    {s.collateralDelta >= 0 ? "+" : ""}
                    {s.collateralDelta.toFixed(6)}{" "}
                    <span className="text-[12px] text-ink-3">{COLLATERAL.symbol}</span>
                  </p>
                ) : null}

                <p className="text-[12px] text-ink-3 mt-1">
                  decoded from the transfer log
                </p>

                {s.error ? (
                  <p className="num text-[11px] text-down mt-2">{s.error}</p>
                ) : null}
              </div>

              <dl className="min-w-0 border border-line self-start w-full">
                {[
                  ["Transaction", `${s.hash.slice(0, 18)}…${s.hash.slice(-8)}`],
                  ["Block", s.blockNumber?.toLocaleString("en-US") ?? "—"],
                  ["From", s.from ? `${s.from.slice(0, 10)}…${s.from.slice(-6)}` : "—"],
                  ["Contract", s.to ? `${s.to.slice(0, 10)}…${s.to.slice(-6)}` : "—"],
                  ["Gas used", s.gasUsed ? Number(s.gasUsed).toLocaleString("en-US") : "—"],
                ].map(([k, v], j, arr) => (
                  <div
                    key={k}
                    className={cx(
                      "flex items-baseline justify-between gap-4 px-3.5 py-2.5",
                      j < arr.length - 1 && "border-b border-line-soft",
                    )}
                  >
                    <dt className="text-[12px] text-ink-3 shrink-0">{k}</dt>
                    <dd className="num text-[12px] text-ink-2 text-right truncate">{v}</dd>
                  </div>
                ))}

                <div className="border-t border-line px-3.5 py-2.5">
                  <a
                    href={s.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
                  >
                    Verify independently
                    <IconArrowOut size={13} />
                  </a>
                </div>
              </dl>
            </div>
          </li>
        ))}
      </ol>

      {/* net result */}
      <div className="mt-6 border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="text-label-xs uppercase text-ink-3">Net result</p>
            <p
              className={cx(
                "num text-[30px] leading-[36px] mt-2",
                (proof.net ?? 0) >= 0 ? "text-up" : "text-down",
              )}
            >
              {proof.net === null
                ? "—"
                : `${proof.net >= 0 ? "+" : ""}${proof.net.toFixed(6)}`}{" "}
              <span className="text-[13px] text-ink-3">{COLLATERAL.symbol}</span>
            </p>
            <p className="text-[12px] text-ink-3 mt-1.5">
              Bought a YES contract, the market resolved YES, the winnings were
              redeemed. Sum of both transfer legs.
            </p>
          </div>

          <p className="num text-[11px] text-ink-4">
            checked {new Date(proof.checkedAt).toISOString().slice(11, 19)} UTC
          </p>
        </div>
      </div>

      <p className="text-[12px] leading-[19px] text-ink-4 mt-5 max-w-[80ch]">
        Why this page exists: a live Event Contract trade needs a window that is
        struck, liquid, and not about to expire. The venue lists windows minutes
        long and does not pre-strike successors, so that cannot be guaranteed at
        any given moment. Rather than stage a fake execution for the demo, PRISM
        proves the lifecycle it has already completed — and lets you check it on
        the explorer yourself.{" "}
        <Link href="/trade" className="text-accent hover:text-ink transition-colors">
          Live execution is on the Trade screen →
        </Link>
      </p>
    </Page>
  );
}
