import Link from "next/link";
import { Refraction } from "@/components/refraction";
import { HeroFieldGL } from "@/components/hero-field-gl";
import { PrismMark, PrismWordmark } from "@/components/logo";
import { Button, cx } from "@/components/ui";
import { IconArrowOut, IconArrowRight } from "@/components/icons";
import { NETWORK } from "@sdk/venue/config";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { getLivePrice } from "@sdk/venue/prices";
import { headroomSec } from "@sdk/venue/types";
import { Reveal } from "@/components/reveal";
import { HeroInstrument } from "@/components/hero-instrument";

/** Live venue state; nothing here can be prerendered. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  // The fold used to render a generated "BTC 4h ladder" of seven fake strikes.
  // The venue lists ONE strike per window, so that ladder never existed. What
  // follows is the real live board.
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

  return (
    <div className="min-h-dvh flex flex-col bg-base">
      <MarketingNav />

      {/* ============================================================
          HERO — the headline owns the full width of the fold, and the
          artifact sits bare on the page beneath it rather than boxed
          into a panel on the right. Deliberately NOT the
          text-column-plus-object-column skeleton.
          ============================================================ */}
      <section className="relative flex-1 min-h-[calc(100dvh-56px)] flex flex-col">


        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div className="w-full max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 py-8">

            {/* THE PANEL OWNS THE FOLD, and the headline crosses its bottom
                edge rather than sitting politely above it. That crossing is the
                composition: foreground type over a midground object, so the
                fold reads with depth instead of as stacked bands. */}
            <div className="relative">
              <Reveal step={0}>
                <div className="relative w-full lg:w-[87%] h-[38vh] min-h-[240px] lg:h-[44vh] overflow-hidden rounded-[26px] border border-line">
                  <HeroFieldGL intensity={0.95} />

                  {/* Inside the panel, on its own layer. Kept to the top so the
                      headline crossing the bottom edge has clear air. */}
                  <div className="absolute inset-0 flex items-start justify-between p-5 sm:p-7">
                    <p className="num text-[13px] leading-[18px] text-ink/85">
                      PRISM
                      <br />
                      <span className="text-ink/55">Event Contracts</span>
                    </p>
                    <Link href="/trade" className="shrink-0">
                      <Button variant="primary" size="md" trailing={<IconArrowRight size={14} />}>
                        Open the terminal
                      </Button>
                    </Link>
                  </div>

                  {/* The notch. A bespoke silhouette rather than a rectangle:
                      the panel is cut away at the bottom right and the links
                      block nests into it, with two inverse corners so the seam
                      reads as one continuous edge. Hidden below lg, where the
                      panel is too narrow for a cut to be legible. */}
                  <div className="hidden lg:block absolute bottom-0 right-0 w-[19rem] h-[7.5rem] bg-base rounded-tl-[26px]">
                    {/* The links live inside the notch, so they are positioned
                        against IT rather than the outer wrapper — which is
                        taller than the panel, and was dropping them below it. */}
                    <ul className="absolute inset-0 flex flex-col items-end justify-center gap-1.5 pr-5">
                      {[
                        { href: "/markets", label: "Live markets" },
                        { href: "/structures", label: "Structures" },
                        { href: "/proof", label: "On-chain proof" },
                      ].map((l) => (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            className="text-[13px] text-ink-2 hover:text-accent transition-colors inline-flex items-center gap-2"
                          >
                            {l.label}
                            <IconArrowOut size={13} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>

              {/* The headline, overlapping the panel's bottom-left. Padded well
                  clear of the panel's rounded corner so no cap is shaved by the
                  cut — content near an edge has to be cleared deliberately. */}
              <Reveal step={1}>
                <h1 className="relative z-20 -mt-[5vh] lg:-mt-[6.5vh] num text-[clamp(34px,6.2vw,86px)] leading-[0.94] tracking-[-0.055em] font-medium text-ink">
                  Event Contracts,
                  <br />
                  <span className="text-accent">refracted.</span>
                </h1>
              </Reveal>
            </div>

            <Reveal step={3}>
              <div className="mt-6 max-w-[46ch]">
                <p className="text-[15px] leading-[24px] text-ink-2">
                  A DreamDEX Event Contract is a digital option that expires every
                  few minutes. PRISM states your view once and carries it across
                  window succession, so a stream of short binaries becomes a
                  position with a real tenor.
                </p>
                <span className="mt-4 text-label-xs uppercase text-ink-4 flex items-center gap-2">
                  <span className="pip-live inline-block w-[5px] h-[5px] bg-up" />
                  Live on {NETWORK.chainName}
                </span>
              </div>
            </Reveal>
          </div>
        </div>

        {/* The live board, moved below the fold. The panel is the fold's one
            artifact now; two competing for the same glance was the problem with
            the previous arrangement. */}
        <div className="relative z-10 border-t border-line">
          <div className="w-full max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 py-8">
            <HeroInstrument
              rows={board.slice(0, 6).map((m) => ({
                marketId: m.marketId,
                asset: m.asset,
                interval: m.interval,
                strike: m.strike,
                expiry: m.expiry,
                routable:
                  m.strike !== null &&
                  m.status === "Trading" &&
                  m.expiry - nowSec > headroomSec(m.intervalSec),
              }))}
              fetchedAt={snap?.fetchedAt ?? Date.now()}
              routableCount={routableCount}
              venueCount={snap ? Object.keys(snap.venues).length : 0}
              oracle={[btc, eth]
                .filter((p): p is NonNullable<typeof p> => Boolean(p))
                .map((p) => ({ asset: p.asset, price: p.price }))}
            />
          </div>
        </div>

        {/* The diagram, given its own band below the fold.
            It used to sit beside the headline as a second artifact competing
            with the board for the same glance — the left-text / right-panel
            skeleton on a thousand landing pages. One artifact owns the fold;
            this one explains it, on its own line, after the scroll begins. */}
        <div className="relative z-10 border-t border-line bg-surface/40 backdrop-blur-md">
          <div className="max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 py-7">
            <p className="text-label-xs uppercase text-ink-4 mb-4">
              One view, carried across successive windows
            </p>
            <div className="max-w-[620px]">
              <Refraction
                legs={[
                  { label: "WINDOW N", detail: "fill" },
                  { label: "WINDOW N+1", detail: "re-strike" },
                  { label: "WINDOW N+2", detail: "carry" },
                ]}
              />
            </div>
          </div>
        </div>

      </section>

      {/* ============================================================
          MECHANISM — three beats on one grid, opened by the step
          number rather than a kicker above a heading.
          ============================================================ */}
      <section className="border-b border-line">
        <div className="max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 py-16 lg:py-24">
          <p className="text-[clamp(22px,3vw,34px)] leading-[1.22] tracking-[-0.02em] text-ink max-w-[26ch]">
            Every prediction market treats the binary as the product. PRISM
            treats it as the <span className="text-accent">basis</span>.
          </p>

          <div className="mt-14 grid md:grid-cols-3 gap-px bg-line border border-line">
            {MECHANISM.map((m) => (
              <article
                key={m.n}
                className="bg-base p-6 lg:p-8 flex flex-col min-h-[268px]"
              >
                <span className="num text-[13px] text-accent">{m.n}</span>
                <h2 className="mt-5 text-title-sm text-ink">{m.title}</h2>
                <p className="mt-3 text-[13px] leading-[21px] text-ink-3">
                  {m.body}
                </p>
                <p className="mt-auto pt-6 text-[11px] leading-[16px] text-ink-4 num">
                  {m.foot}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter
        venues={snap ? Object.keys(snap.venues).length : null}
        assets={snap ? Object.keys(snap.assets).length : null}
      />
    </div>
  );
}

/**
 * The mechanism, as it actually works.
 *
 * These three cards used to describe differentiating a strike ladder into a
 * risk-neutral density, a weight vector over a digital basis, and legs landing
 * in one batched transaction. The venue lists one strike per window, so there
 * is no ladder to differentiate and no basis to solve over; and EIP-7702 is not
 * available on this chain, so the batch was never coming. Marketing copy that
 * promises a product the venue cannot express is the most expensive kind of
 * wrong, because it is the first thing anyone reads.
 */
const MECHANISM = [
  {
    n: "01",
    title: "Read the term structure",
    body: "Every live YES price is a risk-neutral probability. The venue lists one strike per window and five window lengths, so the real structure is that one strike observed across 5m, 15m, 1h, 4h and 24h — a term structure rather than a smile.",
    foot: "One strike per window, five cadences",
  },
  {
    n: "02",
    title: "Price the carry",
    body: "A view is priced against the depth actually resting on the successor's book, not a theoretical mid. If nothing is resting, the plan says so and refuses rather than quoting a fill that cannot happen.",
    foot: "Depth-aware, refuses on an empty book",
  },
  {
    n: "03",
    title: "Fill and roll",
    body: "Every fill is verified from chain — receipt, nonce and collateral delta — never from the SDK's word, which can report success on a reverted transaction. When the window closes, the expiring leg is left to settle and claimed, while the equivalent exposure opens in the successor.",
    foot: "Verified on-chain, settle-don't-churn",
  },
] as const;

function MarketingNav() {
  return (
    <header className="h-14 shrink-0 border-b border-line bg-base/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="h-full max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 flex items-center gap-6">
        <Link href="/" className="inline-flex items-center gap-2.5 shrink-0">
          <PrismMark size={24} />
          <PrismWordmark size={18} className="text-accent" />
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-6 ml-4">
          {[
            { href: "/markets", label: "Markets" },
            { href: "/structures", label: "Structures" },
            { href: "/analytics", label: "Analytics" },
            { href: "/agents", label: "Agents" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[13px] text-ink-3 hover:text-ink transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-2 border border-line h-8 px-2.5 text-label-xs uppercase text-ink-3">
            <span className="pip-live inline-block w-[5px] h-[5px] bg-up" />
            {NETWORK.name}
          </span>
          <Link href="/trade">
            <Button variant="primary" size="sm">
              Launch
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function MarketingFooter({
  venues,
  assets,
}: {
  /** Live venue-id count, or null when the registry was unreachable. */
  venues: number | null;
  /** Live underlying count, same. */
  assets: number | null;
}) {
  return (
    <footer className="relative bg-base">
      <div className="max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 pt-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 pb-14">
          <div className="min-w-0">
            <PrismMark size={30} />
            <p className="mt-4 text-[13px] leading-[20px] text-ink-3 max-w-[30ch]">
              The structured payoff layer for DreamDEX Event Contracts.
            </p>
          </div>

          {FOOTER.map((col) => (
            <div key={col.title} className="min-w-0">
              <p className="text-label-xs uppercase text-ink-4">{col.title}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-[13px] text-ink-3 hover:text-accent transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-5 border-t border-line">
          <p className="text-[12px] text-ink-4">
            Testnet build. Educational reference, not financial advice.
          </p>
          {/* Read off the live registry, not off a constant. The venue-id set
              has already drifted from two to four; printing one hard-coded id
              made the footer quietly wrong the day the venue added a third. */}
          <p className="num text-[12px] text-ink-4">
            {venues !== null && assets !== null
              ? `${venues} venue${venues === 1 ? "" : "s"} · ${assets} underlying${
                  assets === 1 ? "" : "s"
                } · chain ${NETWORK.chainId}`
              : `chain ${NETWORK.chainId}`}
          </p>
        </div>
      </div>

      {/* Oversized wordmark: on the top layer, anchored flush to the very
          bottom edge with no gap beneath it, and given real headroom above
          so no cap is shaved by the container. */}
      <div className="relative overflow-hidden pt-6">
        <span
          aria-hidden
          className="block select-none text-center leading-[0.78] font-semibold tracking-[-0.045em] text-[clamp(72px,19vw,268px)] text-transparent bg-clip-text"
          style={{
            backgroundImage:
              "linear-gradient(180deg, #1c2426 0%, #0d1112 62%, #050505 100%)",
            marginBottom: "-0.14em",
          }}
        >
          PRISM
        </span>
      </div>
    </footer>
  );
}

const FOOTER = [
  {
    title: "Terminal",
    links: [
      { href: "/trade", label: "Trade" },
      { href: "/markets", label: "Markets" },
      { href: "/structures", label: "Structures" },
      { href: "/positions", label: "Positions" },
    ],
  },
  {
    title: "Engine",
    links: [
      { href: "/analytics", label: "Volatility surface" },
      { href: "/roll", label: "Roll engine" },
      { href: "/settlement", label: "Settlement" },
      { href: "/activity", label: "Audit log" },
    ],
  },
  {
    title: "Build",
    links: [
      { href: "/agents", label: "Agent API" },
      { href: "/docs", label: "Documentation" },
      { href: "https://docs.dreamdex.io/developers/event-contracts", label: "DreamDEX docs" },
      { href: "https://github.com/somnia-chain/dreamdex-bot-kit", label: "Bot kit" },
    ],
  },
] as const;
