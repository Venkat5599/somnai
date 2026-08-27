import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead, cx } from "@/components/ui";
import { IconArrowOut, IconCheck, IconCross, IconInfo } from "@/components/icons";
import { COLLATERAL, NETWORK } from "@sdk/venue/config";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { chainCapabilities } from "@sdk/venue/capabilities";
import { structureMatrix, type Constructibility } from "@sdk/venue/structures";

export const metadata: Metadata = { title: "Documentation — PRISM" };

/**
 * This page used to describe a different product.
 *
 * It documented a density engine that differentiates Up prices across a strike
 * ladder, a replication router that goes "long the Up at the lower strike and
 * short the Up at the upper", a collateral token called USDso, automatic
 * succession on window expiry, a session key, and an execution path that was
 * "not yet wired to the venue". Every one of those is false against DreamDEX as
 * deployed: the venue lists ONE strike per window so no ladder exists to
 * differentiate, collateral is tUSDC at six decimals, successors are not
 * pre-struck, there is no session key, and execution has been wired and
 * verified on-chain since the first fill.
 *
 * Documentation that describes a product the venue cannot express is worse than
 * no documentation, because it reads as capability. So the prose was replaced
 * with what is true, and the parts that could rot are no longer prose at all —
 * the structure verdicts and the batching row are READ FROM THE CHAIN on every
 * request, so they cannot drift out of date the way the old copy did.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOTCHAS = [
  "Gate writes on the on-chain market status, not the indexer. Only status 1, Trading, accepts orders, and indexed rows lag the chain by seconds.",
  "A reverted write does not throw. The receipt rides on the info field, so every send is asserted explicitly rather than assumed successful.",
  "Never hand a float probability to an 18-decimal venue. Converting with parseUnits lands wei off the tick grid and the pool rejects with InvalidPrice.",
  "Key state by market id, never by pool address. Pools are recycled across windows, so an address is not a stable identity.",
  "Read the strike and interval fields rather than parsing the question text. Its wording has changed several times.",
  "A strike of 0 means the window is not struck yet. It is a state, not a price, and most longer windows sit in it.",
  "loadMarkets excludes finalized markets, so a redeem-by-scan built on the registry finds nothing on exactly the markets you need to claim from.",
  "Never run two senders on one key. Claiming and trading sign from the same key and will race each other's nonce.",
];

export default async function DocsPage() {
  // Both reads degrade rather than fail: a page that cannot reach the chain
  // should say less, never assert more.
  const [snap, caps] = await Promise.all([
    cachedMarketSnapshot().catch(() => null),
    chainCapabilities().catch(() => null),
  ]);

  const matrix: Constructibility[] = structureMatrix(snap?.all ?? []);
  const strikesSeen = matrix[0]?.strikesAvailable ?? 0;

  const batching = caps
    ? caps.eip7702
      ? "EIP-7702 available"
      : `EIP-7702 absent (pre-Prague)`
    : "chain unreadable";

  const SECTIONS = [
    {
      id: "primitive",
      title: "The primitive",
      body: [
        `A DreamDEX Event Contract is a binary market on an asset finishing above a strike at the close of a fixed window. Collateral is ${COLLATERAL.symbol} at ${COLLATERAL.decimals} decimals, and one unit mints a complete set of one YES and one NO, which burn back to one unit at any time.`,
        "Because the pair sums to one, the YES price is the market's risk-neutral probability that spot finishes above the strike. That is the definition of a cash-or-nothing digital, and everything else in PRISM follows from it.",
      ],
      facts: [
        ["Collateral", `${COLLATERAL.symbol} · ${COLLATERAL.decimals}dp`],
        ["Outcome pair", "1 ⇄ 1 YES + 1 NO"],
        ["Venue", "On-chain CLOB"],
        ["Cadences", "5m · 15m · 1h · 4h · 24h"],
      ],
    },
    {
      id: "axis",
      title: "Why the axis is time, not strike",
      body: [
        `The venue lists exactly one strike per window. Read live just now, the most distinct strikes on any single expiry across ${snap?.all.length ?? 0} markets is ${strikesSeen}. That removes the strike axis entirely: there is no ladder to differentiate, so no risk-neutral density and no strike-axis volatility smile can be derived here, whatever a generic options UI would show.`,
        "What the venue does list is five cadences on the same asset. One strike observed across five window lengths is a genuine term structure, and it is the only real composition axis DreamDEX offers. PRISM is built on the axis that exists rather than the one an options terminal assumes, which is why the product is the roll and not the ladder.",
      ],
      facts: [
        ["Strikes per expiry", String(strikesSeen)],
        ["Markets read", String(snap?.all.length ?? 0)],
        ["Density q(K)", "not derivable"],
        ["Term structure", "derivable"],
      ],
    },
    {
      id: "execution",
      title: "Execution and lifecycle",
      body: [
        `Execution is wired and has been verified on-chain. An order is validated against the live registry and its own book before a signature exists, snapped to the venue's integer tick and lot grid on the server, sent with a mandatory expiry capped at the market's own, and then the outcome is re-derived from chain — receipt status, nonce movement and collateral delta — rather than read off the SDK's return value, which can report success on a reverted transaction.`,
        `Atomic multi-leg batching would need EIP-7702, which ships in Prague. This chain carries none of Prague's system contracts, so 7702 is unavailable rather than unbuilt, and the probe that establishes that runs on every page load. In its place a multi-leg batch refuses whole before anything is signed, sends each leg fill-or-kill so no leg can half-exist, and sells back what already filled if a later leg fails. That is not atomicity, and the result reports which of the four guarantees it actually delivered.`,
        "Settled markets pay only when asked, and a finalised binary leaves the live registry entirely. PRISM sweeps the finalised set directly, redeems each holding through the raw tier with an explicit outcome index, and prices the claim fee-aware, because a winner is paid one minus the settlement fee and never one.",
      ],
      facts: [
        ["Batching", batching],
        ["Per leg", "FILL_OR_KILL"],
        ["Order expiry", "capped at market expiry"],
        ["Verdict from", "receipt · nonce · balance"],
      ],
    },
    {
      id: "roll",
      title: "The roll",
      body: [
        "A window is minutes long, so a view with any real tenor has to be re-struck into the successor every time one closes. A roll here is deliberately not close-and-reopen: the expiring leg is a binary about to settle for its full value, so crossing a spread to exit it would burn the whole edge. The engine lets it settle, claims it on the settlement sweep, and opens the equivalent exposure in the successor window.",
        "The hazard is ordering. The successor leg must open before the current window locks or there is a gap in exposure, which is why the plan refuses to run inside the venue's own expiry headroom — eight percent of the interval, floored at five seconds, so it scales with a five-minute window instead of rejecting every market on the venue.",
        "Successors are not pre-struck. They appear only as the current window nears close, which is exactly why this cannot be run by hand and a daemon has to hold it.",
      ],
      facts: [
        ["Expiring leg", "settled, then claimed"],
        ["Successor leg", "opened before lock"],
        ["Headroom", "8% of interval, min 5s"],
        ["Successor listing", "not pre-struck"],
      ],
    },
  ] as const;

  return (
    <Page>
      <PageHead
        title="Documentation"
        lede="What PRISM does against DreamDEX as deployed, and the venue behaviour every part of it has to respect. The capability rows on this page are read from the chain on each request rather than written down."
      >
        <Chip tone="accent">{NETWORK.chainName}</Chip>
      </PageHead>

      <div className="flex flex-col gap-px bg-line border border-line">
        {SECTIONS.map((s, i) => (
          <section key={s.id} className="bg-surface p-5 sm:p-7 min-w-0">
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <span className="num text-[12px] text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="text-headline-md text-ink">{s.title}</h2>
                </div>
                {s.body.map((p, j) => (
                  <p
                    key={j}
                    className="text-[13px] leading-[22px] text-ink-2 mt-4 max-w-[72ch]"
                  >
                    {p}
                  </p>
                ))}
              </div>

              <dl className="min-w-0 border border-line self-start w-full">
                {s.facts.map(([k, v], j) => (
                  <div
                    key={k}
                    className={cx(
                      "flex items-baseline justify-between gap-4 px-3.5 py-2.5",
                      j < s.facts.length - 1 && "border-b border-line-soft",
                    )}
                  >
                    <dt className="text-[12px] text-ink-3 shrink-0">{k}</dt>
                    <dd className="num text-[12px] text-ink-2 text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        ))}
      </div>

      {/* ============================================================
          Constructibility, decided by the registry rather than asserted.
          The day the venue lists a second strike on one expiry, these
          rows flip on their own.
          ============================================================ */}
      <section className="mt-6 border border-line bg-surface p-5 sm:p-7">
        <h2 className="text-headline-md text-ink">What is constructible right now</h2>
        <p className="text-[13px] leading-[22px] text-ink-3 mt-3 max-w-[72ch]">
          Derived from the live registry on this request, not from a list
          maintained by hand. Each verdict cites the strike and expiry counts it
          was decided from.
        </p>

        <ul className="mt-6 flex flex-col border border-line">
          {matrix.map((m, i) => (
            <li
              key={m.kind}
              className={cx(
                "flex flex-col sm:flex-row sm:items-baseline gap-x-4 gap-y-1.5 px-4 py-3.5",
                i < matrix.length - 1 && "border-b border-line-soft",
              )}
            >
              <span
                className={cx(
                  "inline-flex items-center gap-2 shrink-0 num text-[12px] w-[132px]",
                  m.constructible ? "text-up" : "text-ink-4",
                )}
              >
                {m.constructible ? <IconCheck size={13} /> : <IconCross size={13} />}
                {m.kind}
              </span>
              <span className="text-[13px] leading-[21px] text-ink-2 min-w-0">
                {m.reason}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 border border-line bg-surface p-5 sm:p-7">
        <h2 className="text-headline-md text-ink">Venue behaviour we design around</h2>
        <p className="text-[13px] leading-[22px] text-ink-3 mt-3 max-w-[72ch]">
          Each of these was reproduced against Shannon rather than cited, and
          each is handled inside the SDK layer rather than left to the caller.
        </p>

        <ol className="mt-6 flex flex-col border border-line">
          {GOTCHAS.map((g, i) => (
            <li
              key={i}
              className={cx(
                "flex gap-4 px-4 py-3.5",
                i < GOTCHAS.length - 1 && "border-b border-line-soft",
              )}
            >
              <span className="num text-[12px] text-ink-4 shrink-0 w-5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] leading-[21px] text-ink-2 min-w-0">{g}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6">
          <Note icon={<IconInfo size={14} />}>
            Network: {NETWORK.chainName}, chain id {NETWORK.chainId}. RPC{" "}
            {NETWORK.rpc}. Venue ids are never pinned — active markets were
            verified to span several, so the registry is read unfiltered.
          </Note>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
          {[
            { href: "https://docs.dreamdex.io/developers/event-contracts", label: "DreamDEX Event Contracts" },
            { href: "https://github.com/somnia-chain/dreamdex-bot-kit", label: "dreamdex-bot-kit" },
            { href: "https://testnet.somnia.network", label: "Shannon testnet faucet" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-[13px] text-ink-3 hover:text-accent transition-colors"
            >
              {l.label}
              <IconArrowOut size={13} />
            </a>
          ))}
        </div>
      </section>
    </Page>
  );
}
