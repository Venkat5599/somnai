import Link from "next/link";
import { Refraction } from "@/components/refraction";
import { HeroFieldGL } from "@/components/hero-field-gl";
import { PrismMark, PrismWordmark } from "@/components/logo";
import { IconArrowOut, IconArrowRight } from "@/components/icons";
import { NETWORK } from "@sdk/venue/config";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { getLivePrice } from "@sdk/venue/prices";
import { headroomSec } from "@sdk/venue/types";
import { Reveal } from "@/components/reveal";
import { ClaimMarquee } from "@/components/marquee";
import { McpCopyButton } from "@/components/mcp-install";
import { cx } from "@/components/ui";

/** Live venue state; nothing here can be prerendered. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * THE LANDING PAGE RUNS A LIGHT PALETTE; THE TERMINAL STAYS DARK.
 *
 * Asked for directly, against this project's own default. Deliberate, and worth
 * stating: the marketing surface and the instrument are two different jobs. The
 * instrument is dark because it is stared at for hours; the landing page is read
 * once, and a light surface carries long-form reading better.
 *
 * The palette is scoped HERE rather than in globals.css, so `/trade` and every
 * other terminal route is untouched. Nothing below reads `--color-base` and its
 * siblings — it reads these.
 */
const LIGHT = {
  "--pg-bg": "#F4F4F6",
  "--pg-card": "#FFFFFF",
  "--pg-ink": "#0B0B10",
  "--pg-ink-2": "#4A4A55",
  "--pg-ink-3": "#77778A",
  "--pg-line": "#E4E4EA",
  "--pg-accent": "#6C4CF1",
  "--pg-accent-soft": "#EFEBFE",
} as React.CSSProperties;

/* ------------------------------------------------------------------ */

/** One gutter for every section, so no block can drift to its own edge. */
function Bleed({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("w-full max-w-[1400px] mx-auto px-5 sm:px-8 lg:px-10", className)}>
      {children}
    </div>
  );
}

/**
 * A feature card.
 *
 * No icon in a tinted tile, no category pill, no tag row — piling those into one
 * card is the clearest slop signature there is. A card here is a claim, a short
 * body, and the path in the tree that implements it. That path is the point: it
 * makes every card falsifiable by a reader who doubts it.
 */
function Card({
  title,
  body,
  where,
  href,
  stat,
}: {
  title: string;
  body: string;
  where: string;
  href?: string;
  stat?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-4">
        <h3
          className="text-[clamp(19px,1.7vw,24px)] leading-[1.16] tracking-[-0.02em] font-medium text-balance"
          style={{ color: "var(--pg-ink)" }}
        >
          {title}
        </h3>
        {stat ? (
          <span
            className="num text-[13px] shrink-0 tabular-nums"
            style={{ color: "var(--pg-ink-2)" }}
          >
            {stat}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[14px] leading-[22px] text-pretty" style={{ color: "var(--pg-ink-2)" }}>
        {body}
      </p>
      <p className="num mt-auto pt-6 text-[11px] break-all" style={{ color: "var(--pg-ink-3)" }}>
        {where}
      </p>
      {href ? (
        <span
          className="mt-3 inline-flex items-center gap-2 text-[13px] transition-opacity group-hover:opacity-70"
          style={{ color: "var(--pg-ink)" }}
        >
          Open
          <IconArrowOut size={13} />
        </span>
      ) : null}
    </>
  );

  const shell = "group flex flex-col h-full rounded-[20px] p-6 sm:p-7";
  const style = { background: "var(--pg-card)", border: "1px solid var(--pg-line)" };

  return href ? (
    <Link href={href} className={shell} style={style}>
      {inner}
    </Link>
  ) : (
    <div className={shell} style={style}>
      {inner}
    </div>
  );
}

/** Square-cornered enough to stay an instrument. Never a glowing pill. */
function Cta({
  href,
  children,
  tone = "solid",
}: {
  href: string;
  children: React.ReactNode;
  tone?: "solid" | "quiet";
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 h-11 px-5 rounded-[10px] text-[14px] font-medium transition-opacity hover:opacity-85"
      style={
        tone === "solid"
          ? { background: "var(--pg-ink)", color: "var(--pg-card)" }
          : { background: "var(--pg-card)", color: "var(--pg-ink)", border: "1px solid var(--pg-line)" }
      }
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */

export default async function HomePage() {
  const [snap, btc, eth] = await Promise.all([
    cachedMarketSnapshot().catch(() => null),
    getLivePrice("BTC").catch(() => null),
    getLivePrice("ETH").catch(() => null),
  ]);

  const nowSec = Math.floor(Date.now() / 1000);
  const board = (snap?.active ?? [])
    .slice()
    .sort((a, b) =>
      a.asset === b.asset ? a.intervalSec - b.intervalSec : a.asset.localeCompare(b.asset),
    );
  const routableCount = (snap?.routable ?? []).length;
  const venueCount = snap ? Object.keys(snap.venues).length : 0;
  const assetCount = snap ? Object.keys(snap.assets).length : 0;
  const oracle = [btc, eth].filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div className="min-h-dvh flex flex-col" style={{ ...LIGHT, background: "var(--pg-bg)" }}>
      <MarketingNav />

      {/* ============================================================
          HERO — a centred statement, then the product artifact broken
          past the fold. The artifact is the real board, not a mockup.
          ============================================================ */}
      <section className="pt-14 sm:pt-20">
        <Bleed>
          <Reveal step={0}>
            <h1
              className="mx-auto max-w-[19ch] text-center text-[clamp(36px,6.4vw,78px)] leading-[1.04] tracking-[-0.025em] font-normal text-balance"
              style={{ color: "var(--pg-ink)", fontFamily: "var(--font-display)" }}
            >
              Simply the clearest way to trade{" "}
              <span className="relative inline-block whitespace-nowrap">
                Event Contracts
                {/* Drawn, not a border-bottom. A straight rule under a phrase is
                    a default; this is one stroke with uneven curvature and a
                    rounded cap, so it reads as marked by hand. It sits BELOW the
                    descender line with room to spare — an underline that clips a
                    'y' or a comma is worse than none. */}
                <svg
                  aria-hidden
                  viewBox="0 0 340 18"
                  preserveAspectRatio="none"
                  className="absolute left-0 -bottom-[0.18em] w-full h-[0.22em] overflow-visible"
                >
                  <path
                    d="M3 12.5C58 5.5 122 3.2 186 4.6c47 1 96 3.9 151 8.2"
                    fill="none"
                    stroke="var(--pg-accent)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </span>
            </h1>
          </Reveal>

          <Reveal step={1}>
            <p
              className="mx-auto mt-6 max-w-[62ch] text-center text-[16px] leading-[26px] text-pretty"
              style={{ color: "var(--pg-ink-2)" }}
            >
              DreamDEX Event Contracts expire every few minutes. PRISM reads them
              live from Somnia, executes on the venue&rsquo;s own integer grid,
              verifies every outcome from chain, and carries a view into the
              successor window.
            </p>
          </Reveal>

          <Reveal step={2}>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              {/* /markets, not /trade. Most windows are unstruck at any given
                  moment — 10 of 14 when last measured — so a first-time visitor
                  landing on the ticket sees "no strike yet" and reads the whole
                  product as empty. The board is never empty: it shows the full
                  registry, and routable rows are marked. Let them choose a live
                  market and arrive at the ticket with something in it. */}
              <Cta href="/markets">
                Open the terminal
                <IconArrowRight size={15} />
              </Cta>
              {/* The agent entry point, one click. A visitor can paste this
                  straight into Claude Desktop and drive PRISM from there —
                  which is the thing worth showing, and it was previously
                  buried three pages deep on /agents. */}
              <span
                style={{
                  ["--btn-bg" as string]: "var(--pg-card)",
                  ["--btn-ink" as string]: "var(--pg-ink)",
                }}
              >
                <McpCopyButton className="inline-flex items-center gap-2 h-11 px-5 rounded-[10px] text-[14px] font-medium transition-opacity hover:opacity-85 bg-[var(--pg-card)] text-[var(--pg-ink)] border border-[var(--pg-line)]" />
              </span>
            </div>
          </Reveal>
        </Bleed>

        {/* The artifact, clipped by the fold so it continues past the screen the
            way a real product shot does. Every row is a live registry row. */}
        <Bleed className="mt-14">
          <Reveal step={3}>
            <div
              className="relative overflow-hidden rounded-t-[24px] sm:rounded-t-[30px]"
              style={{
                border: "1px solid var(--pg-line)",
                borderBottom: "none",
                background: "var(--pg-card)",
              }}
            >
              <div className="relative h-[86px] sm:h-[118px] overflow-hidden">
                <HeroFieldGL intensity={0.9} base="#F4F4F6" accent="#6C4CF1" />
                <div className="absolute inset-0 flex items-center justify-between gap-4 px-5 sm:px-7">
                  <p
                    className="num text-[12px] sm:text-[13px] leading-[17px]"
                    style={{ color: "var(--pg-ink)" }}
                  >
                    PRISM
                    <br />
                    <span style={{ color: "var(--pg-ink-3)" }}>Live board</span>
                  </p>
                  <span
                    className="num text-[12px] tabular-nums text-right"
                    style={{ color: "var(--pg-ink-2)" }}
                  >
                    {routableCount} routable · {venueCount} venue{venueCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              {oracle.length > 0 ? (
                <div
                  className="grid grid-cols-2"
                  style={{
                    borderTop: "1px solid var(--pg-line)",
                    borderBottom: "1px solid var(--pg-line)",
                  }}
                >
                  {oracle.map((o, i) => (
                    <div
                      key={o.asset}
                      className="px-5 py-4 sm:px-7"
                      style={i === 0 ? { borderRight: "1px solid var(--pg-line)" } : undefined}
                    >
                      <p className="text-label-xs uppercase" style={{ color: "var(--pg-ink-3)" }}>
                        {o.asset} oracle
                      </p>
                      <p
                        className="num text-[19px] sm:text-[22px] mt-1"
                        style={{ color: "var(--pg-ink)" }}
                      >
                        {o.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {board.length === 0 ? (
                <p className="px-5 sm:px-7 py-8 text-[13px]" style={{ color: "var(--pg-ink-2)" }}>
                  The venue returned no active markets. Nothing is being substituted.
                </p>
              ) : (
                <ul>
                  {board.slice(0, 7).map((m) => {
                    const left = m.expiry - nowSec;
                    const live =
                      m.strike !== null &&
                      m.status === "Trading" &&
                      left > headroomSec(m.intervalSec);
                    return (
                      <li
                        key={m.marketId}
                        className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 px-5 sm:px-7 py-3"
                        style={{ borderBottom: "1px solid var(--pg-line)" }}
                      >
                        <span className="num text-[13px] truncate" style={{ color: "var(--pg-ink)" }}>
                          {m.asset} <span style={{ color: "var(--pg-ink-3)" }}>{m.interval}</span>
                        </span>
                        <span
                          className="num text-[13px] tabular-nums"
                          style={{ color: "var(--pg-ink-2)" }}
                        >
                          {m.strike !== null ? m.strike.toLocaleString("en-US") : "unstruck"}
                        </span>
                        <span
                          className="num text-[13px] tabular-nums w-[5rem] text-right"
                          style={{ color: live ? "var(--pg-ink)" : "var(--pg-ink-3)" }}
                        >
                          {left <= 0 ? "closed" : `${Math.floor(left / 60)}m ${left % 60}s`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Reveal>
        </Bleed>
      </section>

      <div className="mt-14">
        <ClaimMarquee base="#F4F4F6" accent="#6C4CF1" ink="#3A3A46" />
      </div>

      {/* ============================================================
          WHAT THE VENUE ACTUALLY SUPPORTS
          ============================================================ */}
      <section className="py-16 sm:py-24">
        <Bleed>
          <h2
            className="max-w-[16ch] text-[clamp(30px,4.6vw,56px)] leading-[1.06] tracking-[-0.02em] font-normal text-balance"
            style={{ color: "var(--pg-ink)", fontFamily: "var(--font-display)" }}
          >
            Everything the venue actually supports
          </h2>
          <p
            className="mt-5 max-w-[58ch] text-[15px] leading-[24px] text-pretty"
            style={{ color: "var(--pg-ink-2)" }}
          >
            One strike per window and five cadences per asset. That kills
            composition across strike, which is why the roll is the product here
            and not the ladder — and why Range, Spread and Ladder are reported as
            unconstructible rather than quietly omitted.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              title="Discovery, normalised once"
              body="Binary rows from the Somnia indexer become a typed EventMarket at one boundary, so nothing downstream does arithmetic on a decimal string. Every discarded row is counted by reason."
              where="sdk/venue/normalize.ts"
              stat={snap ? `${snap.all.length} rows` : undefined}
              href="/markets"
            />
            <Card
              title="Execution on the integer grid"
              body="Price and size snap to the venue's own tick and lot, read from the pool, as exact integers. A float reaching an 18-decimal venue lands off-grid and reverts — and is invisible on a 6-decimal testnet."
              where="sdk/dreamdex/place-limit.ts"
              href="/trade"
            />
            <Card
              title="Verification independent of the SDK"
              body="A write can resolve without throwing on a reverted transaction. Outcomes are re-derived from receipt, nonce movement and collateral delta — and may answer UNKNOWN, which is never rendered as success."
              where="sdk/dreamdex/execution.ts"
              href="/proof"
            />
            <Card
              title="Settlement that finds your winnings"
              body="loadMarkets excludes finalized markets, so a redeem-by-scan built on the registry finds nothing on exactly the markets you need to claim from. This reads listBinaryMarkets and redeems through the raw tier."
              where="sdk/dreamdex/settlement.ts"
              href="/settlement"
            />
            <Card
              title="Cancellation re-read from chain"
              body="A green receipt says the transaction executed, not that every id in it was pulled — a batch cancel skips stale ids silently. What is still resting comes from getOwnOpenOrdersOnchain, never the indexer."
              where="sdk/dreamdex/cancel.ts"
            />
            <Card
              title="dreamBot Builder configs"
              body="All six Event Contract strategies run on PRISM's verified path, under the kit's names or the Builder's. A probe reads the kit's own docs and fails if this list has drifted in either direction."
              where="sdk/bot/config.ts"
              stat="6 / 6"
              href="/agents"
            />
          </div>
        </Bleed>
      </section>

      {/* ============================================================
          THE TWO LARGE CARDS
          ============================================================ */}
      <section className="pb-16 sm:pb-24">
        <Bleed>
          <div className="grid gap-4 lg:grid-cols-2">
            <div
              className="rounded-[20px] p-6 sm:p-9 flex flex-col"
              style={{ background: "var(--pg-card)", border: "1px solid var(--pg-line)" }}
            >
              <h3
                className="text-[clamp(21px,2.3vw,30px)] leading-[1.1] tracking-[-0.03em] font-semibold"
                style={{ color: "var(--pg-ink)" }}
              >
                The Roll Engine
              </h3>
              <p
                className="mt-4 max-w-[46ch] text-[14px] leading-[22px] text-pretty"
                style={{ color: "var(--pg-ink-2)" }}
              >
                A window closes every few minutes. Carrying a view across the
                succession by hand, forever, is the problem PRISM exists to
                remove. It does not churn the expiring leg — it lets that settle
                and claims it, while opening the equivalent exposure in the
                successor.
              </p>
              <div className="mt-8">
                <Refraction
                  legs={[
                    { label: "WINDOW N", detail: "fill" },
                    { label: "WINDOW N+1", detail: "re-strike" },
                    { label: "WINDOW N+2", detail: "carry" },
                  ]}
                />
              </div>
              <p className="num mt-auto pt-7 text-[11px]" style={{ color: "var(--pg-ink-3)" }}>
                sdk/dreamdex/roll.ts · backend/roll
              </p>
            </div>

            <div
              className="rounded-[20px] p-6 sm:p-9 flex flex-col"
              style={{ background: "var(--pg-card)", border: "1px solid var(--pg-line)" }}
            >
              <h3
                className="text-[clamp(21px,2.3vw,30px)] leading-[1.1] tracking-[-0.03em] font-semibold"
                style={{ color: "var(--pg-ink)" }}
              >
                Multi-leg, graded honestly
              </h3>
              <p
                className="mt-4 max-w-[46ch] text-[14px] leading-[22px] text-pretty"
                style={{ color: "var(--pg-ink-2)" }}
              >
                EIP-7702 ships in Prague and this chain is pre-Prague, so atomic
                batching is unavailable — probed at runtime, not asserted. Every
                leg is gated before a signature exists, and a leg that fills
                after a later one fails is sold back and the sale verified.
              </p>
              <ul
                className="mt-6 rounded-[14px] overflow-hidden"
                style={{ border: "1px solid var(--pg-line)" }}
              >
                {[
                  ["PREFLIGHT_ALL_OR_NOTHING", "refused whole; nothing sent"],
                  ["SEQUENTIAL_VERIFIED", "every leg filled and verified"],
                  ["PARTIAL_UNWOUND", "a leg failed; the rest sold back"],
                  ["PARTIAL_EXPOSED", "a leg failed AND an unwind failed"],
                ].map(([k, v], i) => (
                  <li
                    key={k}
                    className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1"
                    style={i > 0 ? { borderTop: "1px solid var(--pg-line)" } : undefined}
                  >
                    <span
                      className="num text-[12px] shrink-0"
                      style={{ color: k === "PARTIAL_EXPOSED" ? "#C0392B" : "var(--pg-ink)" }}
                    >
                      {k}
                    </span>
                    <span className="text-[12px]" style={{ color: "var(--pg-ink-3)" }}>
                      {v}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="num mt-auto pt-7 text-[11px]" style={{ color: "var(--pg-ink-3)" }}>
                sdk/dreamdex/batch.ts · atomicity.ts
              </p>
            </div>
          </div>
        </Bleed>
      </section>

      {/* ============================================================
          THE EVIDENCE PANEL
          ============================================================ */}
      <section className="pb-16 sm:pb-24">
        <Bleed>
          <div
            className="relative overflow-hidden rounded-[24px]"
            style={{ background: "var(--pg-ink)" }}
          >
            <HeroFieldGL intensity={0.9} base="#0B0B10" accent="#6C4CF1" />
            <div className="relative z-10 p-6 sm:p-11 lg:p-14">
            <h2 className="max-w-[22ch] text-[clamp(28px,3.8vw,48px)] leading-[1.06] tracking-[-0.02em] font-normal text-balance text-white"
              style={{ fontFamily: "var(--font-display)" }}>
              Everything here is on chain, or it is not claimed.
            </h2>
            <p className="mt-5 max-w-[54ch] text-[15px] leading-[24px] text-white/70 text-pretty">
              A buy and a redeem, a multi-leg batch that had to unwind, an order
              placed and pulled, and two oracle-driven fills — each one a
              transaction you can open on the explorer. The claims that could not
              be proven say so instead of going quiet.
            </p>

            <dl className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Verified round trip", "buy + redeem, net +0.114 tUSDC"],
                ["Batch", "PARTIAL_UNWOUND, sale verified"],
                ["Cancel", "resting 1 → 0, re-read from chain"],
                ["Oracle strategy", "2 fills of 3 signals"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[14px] px-4 py-4 bg-white/[0.06]">
                  <dt className="text-label-xs uppercase text-white/45">{k}</dt>
                  <dd className="text-[13px] text-white/85 mt-1.5 text-pretty">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/proof"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-[10px] text-[14px] font-medium transition-opacity hover:opacity-85"
                style={{ background: "#ffffff", color: "var(--pg-ink)" }}
              >
                Read the proof
                <IconArrowRight size={15} />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-[10px] text-[14px] text-white/75 hover:text-white transition-colors"
              >
                What is not implemented, and why
                <IconArrowOut size={14} />
              </Link>
            </div>
            </div>
          </div>
        </Bleed>
      </section>

      <MarketingFooter venues={venueCount} assets={assetCount} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/structures", label: "Structures" },
  { href: "/analytics", label: "Analytics" },
  { href: "/roll", label: "Roll" },
  { href: "/proof", label: "Proof" },
  { href: "/agents", label: "Agents" },
];

function MarketingNav() {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-xl"
      style={{
        background: "color-mix(in srgb, var(--pg-bg) 82%, transparent)",
        borderBottom: "1px solid var(--pg-line)",
      }}
    >
      <Bleed className="h-16 flex items-center gap-6">
        <Link href="/" className="inline-flex items-center gap-2.5 shrink-0">
          <PrismMark size={26} />
          <span style={{ color: "var(--pg-ink)" }}>
            <PrismWordmark size={19} />
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden lg:flex items-center gap-6 ml-3">
          {NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[13.5px] transition-opacity hover:opacity-60"
              style={{ color: "var(--pg-ink-2)" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          <span
            className="hidden sm:inline-flex items-center gap-2 h-9 px-3 rounded-[9px] text-label-xs uppercase"
            style={{
              background: "var(--pg-card)",
              color: "var(--pg-ink-2)",
              border: "1px solid var(--pg-line)",
            }}
          >
            <span
              className="pip-live inline-block w-[5px] h-[5px] rounded-full"
              style={{ background: "var(--pg-ink)" }}
            />
            {NETWORK.name}
          </span>
          {/* The board, not the ticket — see the note on the hero CTA. */}
          <Link
            href="/markets"
            className="inline-flex items-center h-9 px-4 rounded-[9px] text-[13.5px] font-medium transition-opacity hover:opacity-85"
            style={{ background: "var(--pg-ink)", color: "var(--pg-card)" }}
          >
            Launch
          </Link>
        </div>
      </Bleed>

      {/* Six destinations do not need a drawer. A scrollable rail keeps every one
          of them a single tap away instead of two. */}
      <nav
        aria-label="Primary, compact"
        className="lg:hidden overflow-x-auto"
        style={{ borderTop: "1px solid var(--pg-line)" }}
      >
        <ul className="flex items-center gap-5 px-5 py-2.5 w-max">
          {NAV.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="text-[13px] whitespace-nowrap"
                style={{ color: "var(--pg-ink-2)" }}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function MarketingFooter({ venues, assets }: { venues: number; assets: number }) {
  const columns = [
    {
      head: "Terminal",
      items: [
        { href: "/trade", label: "Trade" },
        { href: "/markets", label: "Markets" },
        { href: "/structures", label: "Structures" },
        { href: "/analytics", label: "Analytics" },
      ],
    },
    {
      head: "Positions",
      items: [
        { href: "/positions", label: "Positions" },
        { href: "/roll", label: "Roll Engine" },
        { href: "/settlement", label: "Settlement" },
        { href: "/activity", label: "Activity" },
      ],
    },
    {
      head: "Evidence",
      items: [
        { href: "/proof", label: "On-chain proof" },
        { href: "/docs", label: "Documentation" },
        { href: "/agents", label: "Bot integration" },
        { href: "/settings", label: "Venue settings" },
      ],
    },
  ];

  return (
    <footer className="mt-auto" style={{ borderTop: "1px solid var(--pg-line)" }}>
      <Bleed className="pt-14 pb-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,auto))] lg:gap-16">
          <div className="min-w-0">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <PrismMark size={24} />
              <span style={{ color: "var(--pg-ink)" }}>
                <PrismWordmark size={18} />
              </span>
            </Link>
            <p
              className="mt-4 max-w-[34ch] text-[13px] leading-[21px] text-pretty"
              style={{ color: "var(--pg-ink-2)" }}
            >
              Strategy infrastructure for DreamDEX Event Contracts. Testnet build
              — educational reference, not financial advice.
            </p>
          </div>

          {columns.map((c) => (
            <div key={c.head} className="min-w-0">
              <p className="text-label-xs uppercase" style={{ color: "var(--pg-ink-3)" }}>
                {c.head}
              </p>
              <ul className="mt-4 space-y-2.5">
                {c.items.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      className="text-[13px] transition-opacity hover:opacity-60"
                      style={{ color: "var(--pg-ink-2)" }}
                    >
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-12 pt-6 flex flex-wrap items-center justify-between gap-4"
          style={{ borderTop: "1px solid var(--pg-line)" }}
        >
          <p className="text-[12px]" style={{ color: "var(--pg-ink-3)" }}>
            Built on {NETWORK.chainName} · chain {NETWORK.chainId}
          </p>
          <p className="num text-[12px]" style={{ color: "var(--pg-ink-3)" }}>
            {venues} venue{venues === 1 ? "" : "s"} · {assets} underlying
            {assets === 1 ? "" : "s"}, read live
          </p>
        </div>
      </Bleed>

      {/* Anchored flush to the bottom edge with headroom above, so no cap is
          shaved by the container. */}
      <div className="relative overflow-hidden pt-3">
        <span
          aria-hidden
          className="num block select-none text-center leading-[0.76] font-semibold tracking-[-0.05em] text-[clamp(64px,17vw,230px)]"
          style={{ color: "color-mix(in srgb, var(--pg-ink) 7%, transparent)" }}
        >
          PRISM
        </span>
      </div>
    </footer>
  );
}
