import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead, cx } from "@/components/ui";
import { IconArrowOut, IconInfo } from "@/components/icons";
import { LIFECYCLE } from "@/lib/dreamdex/proof";
import { VENUE_CONFIG } from "@/lib/venue/config";

export const metadata: Metadata = { title: "Integration — PRISM" };

/**
 * The integration surface, documented from the code that exists.
 *
 * This page previously showed an invented REQUEST/RESPONSE pair for an HTTP API
 * PRISM does not serve. It now documents the actual exported modules — the same
 * functions the app itself calls — with the real verified transaction as the
 * worked example. Nothing here describes a capability that is not in the repo.
 */

const MODULES = [
  {
    path: "lib/venue/markets.ts",
    purpose: "Discovery and normalization",
    fns: [
      ["getMarketSnapshot()", "548 binary rows → typed EventMarket, venue-scoped"],
      ["successionChain(snap, asset, sec)", "the windows a position rolls through"],
      ["termStructure(snap, asset)", "one strike across five real cadences"],
    ],
  },
  {
    path: "lib/venue/prices.ts",
    purpose: "Somnia EMA oracle",
    fns: [
      ["getLivePrice(asset)", "spot + EMA + block number"],
      ["getCandles(asset, tf, limit)", "OHLC, seconds, sorted and de-duplicated"],
    ],
  },
  {
    path: "lib/dreamdex/execution.ts",
    purpose: "Validate → submit → verify",
    fns: [
      ["validateOrder(intent, market, book)", "13 typed reasons, before any signature"],
      ["submitOrder(v, side)", "never throws — a throw is itself evidence"],
      ["verifyExecution(submit, before)", "re-derives from chain; may answer UNKNOWN"],
    ],
  },
  {
    path: "lib/dreamdex/place-limit.ts",
    purpose: "Mainnet-safe placement",
    fns: [
      ["placeLimit(args)", "tick/lot integer grid, raw trader tier"],
      ["toSteps(human, one, step, mode)", "no float ever reaches the wire"],
    ],
  },
  {
    path: "lib/dreamdex/settlement.ts",
    purpose: "Claim what the registry hides",
    fns: [
      ["findClaimable(scan)", "listBinaryMarkets(Finalized) + on-chain balances"],
      ["claim(row)", "raw redeem with EXPLICIT outcomeIdx (a void pays both sides)"],
    ],
  },
  {
    path: "lib/dreamdex/roll.ts",
    purpose: "Strategy layer",
    fns: [
      ["planRoll(args)", "pure; typed blockers, nothing signed"],
      ["executeRoll(args)", "re-plans server-side before signing"],
    ],
  },
  {
    path: "runner/index.ts",
    purpose: "Always-on daemon",
    fns: [
      ["rollTick()", "carry into a struck, liquid successor"],
      ["claimTick()", "sweep settled markets — same loop, same key, no nonce race"],
    ],
  },
] as const;

export default function IntegrationPage() {
  return (
    <Page>
      <PageHead
        title="Integration surface"
        lede="PRISM's DreamDEX integration is a set of typed modules, not an HTTP service. These are the functions the app itself calls — documented from the code that exists, with the real verified transaction as the example."
      >
        <Chip tone="neutral">Module reference</Chip>
      </PageHead>

      <Note icon={<IconInfo size={14} />}>
        <span className="font-medium text-ink">PRISM does not serve a public API.</span>{" "}
        This page used to show an invented request and response for an endpoint
        that does not exist. Everything below maps to a real file in the
        repository.
      </Note>

      <div className="mt-6 flex flex-col gap-px bg-line border border-line">
        {MODULES.map((m) => (
          <section key={m.path} className="bg-surface p-5 min-w-0">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="num text-[13px] text-accent truncate">{m.path}</p>
                <p className="text-[12px] text-ink-3 mt-1.5">{m.purpose}</p>
              </div>
              <dl className="min-w-0">
                {m.fns.map(([sig, note], i, arr) => (
                  <div
                    key={sig}
                    className={cx(
                      "py-2.5",
                      i < arr.length - 1 && "border-b border-line-soft",
                    )}
                  >
                    <dt className="num text-[12px] text-ink-2">{sig}</dt>
                    <dd className="text-[12px] text-ink-3 mt-1">{note}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        ))}
      </div>

      <section className="mt-6 border border-line bg-surface p-5">
        <h2 className="text-title-sm text-ink">The worked example</h2>
        <p className="text-[13px] leading-[21px] text-ink-3 mt-2 max-w-[72ch]">
          One round trip through the modules above, on Somnia Shannon. Both
          hashes resolve on the explorer; the Proof screen re-reads them from
          chain on every load rather than displaying stored values.
        </p>

        <div className="mt-4 flex flex-col gap-px bg-line border border-line">
          {[
            ["Open position", LIFECYCLE.buy, "validateOrder → placeLimit → verifyExecution"],
            ["Redeem winnings", LIFECYCLE.redeem, "findClaimable → claim → chain verify"],
          ].map(([label, hash, path]) => (
            <div key={hash} className="bg-surface p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-ink">{label}</p>
                <p className="num text-[11px] text-ink-4 mt-1">{path}</p>
              </div>
              <a
                href={`${VENUE_CONFIG.explorer}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="num inline-flex items-center gap-1.5 text-[12px] text-accent hover:text-ink transition-colors shrink-0"
              >
                {hash.slice(0, 12)}…{hash.slice(-6)}
                <IconArrowOut size={12} />
              </a>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
