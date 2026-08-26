import Link from "next/link";
import { Refraction } from "@/components/refraction";
import { HeroField } from "@/components/hero-field";
import { PrismMark, PrismWordmark } from "@/components/logo";
import { Button, cx } from "@/components/ui";
import { IconArrowOut, IconArrowRight } from "@/components/icons";
import { NETWORK } from "@/lib/venue/config";
import { getMarketSnapshot } from "@/lib/venue/markets";
import { getLivePrice } from "@/lib/venue/prices";
import { headroomSec } from "@/lib/venue/types";

/** Live venue state; nothing here can be prerendered. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  // The fold used to render a generated "BTC 4h ladder" of seven fake strikes.
  // The venue lists ONE strike per window, so that ladder never existed. What
  // follows is the real live board.
  const [snap, btc, eth] = await Promise.all([
    getMarketSnapshot().catch(() => null),
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
        {/* Atmosphere. Purely decorative and mounted after paint — every
            element below renders complete if it never arrives. */}
        <HeroField />

        <div className="relative z-10 flex-1 flex flex-col [justify-content:safe_center]">
          <div className="w-full max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12 py-8">
            <h1 className="num text-[clamp(34px,6vw,84px)] leading-[0.96] tracking-[-0.055em] font-medium text-ink">
              Event Contracts,
              <br />
              <span className="text-accent">refracted.</span>
            </h1>

            <div className="mt-8 lg:mt-10 grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
              <div className="min-w-0">
                <p className="text-[15px] leading-[24px] text-ink-2">
                  A DreamDEX Event Contract is a digital option that expires
                  every few minutes. PRISM states your view once and carries it
                  across window succession, so a stream of five-minute binaries
                  becomes a position with a real tenor. Live markets are read
                  from Somnia; execution and settlement are being integrated.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-4">
                  <Link href="/trade">
                    <Button
                      variant="primary"
                      size="lg"
                      trailing={<IconArrowRight size={16} />}
                    >
                      Open the terminal
                    </Button>
                  </Link>
                  <Link
                    href="/analytics"
                    className="text-[13px] text-ink-3 hover:text-accent transition-colors inline-flex items-center gap-2"
                  >
                    See the volatility surface
                    <IconArrowOut size={14} />
                  </Link>
                </div>

                <p className="mt-6 text-label-xs uppercase text-ink-4 flex items-center gap-2">
                  <span className="pip-live inline-block w-[5px] h-[5px] bg-up" />
                  Live on {NETWORK.chainName}
                </p>
              </div>

              {/* The artifact, unboxed. It is the page's own diagram.
                  Capped so its proportions hold on a wide viewport instead of
                  stretching until the beam reads as a stray line. */}
              <div className="min-w-0 lg:pt-1 max-w-[620px]">
                <p className="text-label-xs uppercase text-ink-4 mb-4">
                  One view, carried across successive windows
                </p>
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
        </div>

        {/* Live board, flush to the fold's bottom edge. Real markets read from
            the Somnia indexer at request time — one strike per window, which is
            exactly why PRISM composes across succession rather than a ladder. */}
        <div className="relative z-10 border-y border-line bg-surface/60 backdrop-blur-md">
          <div className="max-w-[1560px] mx-auto px-5 sm:px-8 lg:px-12">
            <div className="flex items-stretch overflow-x-auto">
              <div className="flex items-center gap-3 pr-6 py-3 shrink-0 border-r border-line">
                <span className="text-label-xs uppercase text-ink-3">Live board</span>
                <span className="num text-[13px] text-ink">
                  {routableCount} routable
                </span>
              </div>

              {btc || eth ? (
                <div className="flex items-center gap-5 px-5 py-3 shrink-0 border-r border-line">
                  {[btc, eth].filter(Boolean).map((p) => (
                    <span key={p!.asset} className="flex flex-col justify-center">
                      <span className="text-label-xs uppercase text-ink-4">
                        {p!.asset} oracle
                      </span>
                      <span className="num text-[13px] text-ink mt-0.5">
                        {p!.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}

              {board.length === 0 ? (
                <div className="flex items-center px-5 py-3 text-[12px] text-ink-3">
                  Venue returned no active markets right now.
                </div>
              ) : (
                board.map((m) => {
                  const left = m.expiry - nowSec;
                  const routable =
                    m.strike !== null &&
                    m.status === "Trading" &&
                    left > headroomSec(m.intervalSec);
                  return (
                    <div
                      key={m.marketId}
                      className="flex flex-col justify-center px-5 py-3 shrink-0 border-r border-line-soft last:border-r-0"
                    >
                      <span className="num text-[11px] text-ink-4">
                        {m.asset} {m.interval}
                      </span>
                      <span
                        className={cx(
                          "num text-[13px] mt-0.5",
                          routable ? "text-up" : "text-ink-3",
                        )}
                      >
                        {m.strike !== null
                          ? m.strike.toLocaleString("en-US", { minimumFractionDigits: 2 })
                          : "unstruck"}
                      </span>
                    </div>
                  );
                })
              )}
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

      <MarketingFooter />
    </div>
  );
}

const MECHANISM = [
  {
    n: "01",
    title: "Read the strip",
    body: "Every live Up price is a risk-neutral probability. Repaired for monotonicity and differentiated across strikes, the ladder becomes a full risk-neutral density and an implied volatility surface.",
    foot: "Breeden-Litzenberger, 1978",
  },
  {
    n: "02",
    title: "Solve the legs",
    body: "Your payoff intent becomes a weight vector over the digital basis, constrained by the depth actually resting on each book rather than a theoretical mid.",
    foot: "Depth-aware replication router",
  },
  {
    n: "03",
    title: "Fill and roll",
    body: "Legs are intended to land in one batched transaction, so no leg risk. When the window expires, the roll engine re-strikes into the successor market and the position keeps its tenor.",
    foot: "Batched execution — planned",
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

function MarketingFooter() {
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
          <p className="num text-[12px] text-ink-4">
            venue {NETWORK.venueId.slice(0, 10)}…{NETWORK.venueId.slice(-6)}
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
