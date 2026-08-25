import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead, cx } from "@/components/ui";
import { IconArrowOut, IconInfo } from "@/components/icons";
import { NETWORK } from "@/lib/data";

export const metadata: Metadata = { title: "Documentation — PRISM" };

const SECTIONS = [
  {
    id: "primitive",
    title: "The primitive",
    body: [
      "A DreamDEX Event Contract is a binary market on an asset finishing above a strike at the close of a fixed window. Collateral is USDso, and one unit mints a complete set of one Up and one Down, which merge back to one unit at any time.",
      "Because the pair sums to one, the Up price is the market's risk-neutral probability that spot finishes above the strike. That is the definition of a cash-or-nothing digital option, which is why the whole of PRISM follows from it.",
    ],
    facts: [
      ["Collateral", "USDso"],
      ["Outcome pair", "1 USDso ⇄ 1 Up + 1 Down"],
      ["Venue", "On-chain CLOB"],
      ["Succession", "Automatic on window expiry"],
    ],
  },
  {
    id: "density",
    title: "Density engine",
    body: [
      "Sorted by strike, the Up prices form a survival function. Traded ladders cross, so a pool-adjacent-violators pass restores monotonicity first; differentiating a crossed ladder yields negative probability lobes and an unusable surface.",
      "Differentiating the repaired survival function with respect to strike gives the risk-neutral density, following Breeden and Litzenberger (1978). Inverting each rung's price through N(d2) gives implied volatility in closed form, with no root search.",
    ],
    facts: [
      ["Repair", "Pool adjacent violators"],
      ["Density", "q(K) = -d/dK P(S>K)"],
      ["Implied vol", "Closed-form inverse of N(d2)"],
      ["Refresh", "Per block"],
    ],
  },
  {
    id: "router",
    title: "Replication router",
    body: [
      "A payoff intent becomes a weight vector over the digital basis. A range is long the Up at the lower strike and short the Up at the upper: the pair nets to exactly one contract inside the band and zero outside it.",
      "The solve is constrained by resting depth at each rung rather than a theoretical mid, so a structure the book cannot absorb comes back scaled with its fill ratio stated rather than quietly slipping at execution.",
    ],
    facts: [
      ["Basis", "Up and Down across the ladder"],
      ["Constraint", "Resting depth per rung"],
      ["Quantisation", "Integer tick and lot units"],
      ["Output", "Signed leg set"],
    ],
  },
  {
    id: "execution",
    title: "Execution and lifecycle",
    body: [
      "The intended execution path submits legs as a single EIP-7702 batch, so a structure opens whole or not at all, with a mandatory expiry scaled to a fraction of the series interval so a crashed process leaves no orphaned resting size. Neither is implemented in this build — execution is not yet wired to the venue.",
      "Settled markets pay only when asked, and a finalised binary leaves the live registry entirely. PRISM sweeps the finalised set, redeems every leg of a structure, and nets the result into one payout.",
    ],
    facts: [
      ["Batching", "EIP-7702 (planned)"],
      ["Signer", "Session key (planned)"],
      ["Order expiry", "Scaled to interval"],
      ["Claim", "Swept from Finalized status"],
    ],
  },
] as const;

const GOTCHAS = [
  "Gate writes on the on-chain market status, not the indexer. Only status 1, Trading, accepts orders, and indexed rows lag the chain by seconds.",
  "A reverted write does not throw. The receipt rides on the info field, so every send is asserted explicitly rather than assumed successful.",
  "Never hand a float probability to an 18-decimal venue. Converting with parseUnits lands wei off the tick grid and the pool rejects with InvalidPrice.",
  "Key state by market id or symbol, never by pool address. Pools are recycled across windows, so an address is not a stable identity.",
  "Read the strike and interval fields rather than parsing the question text. Its wording has changed several times.",
  "Never run two senders on one key. Claiming and trading sign from the same key and will race each other's nonce.",
];

export default function DocsPage() {
  return (
    <Page>
      <PageHead
        title="Documentation"
        lede="How PRISM turns a strip of Event Contracts into a structured payoff, and the venue behaviour every part of it has to respect."
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

      <section className="mt-6 border border-line bg-surface p-5 sm:p-7">
        <h2 className="text-headline-md text-ink">Venue behaviour we design around</h2>
        <p className="text-[13px] leading-[22px] text-ink-3 mt-3 max-w-[72ch]">
          These are the sharp edges documented by the DreamDEX bot kit. Each one
          is handled inside the router rather than left to the caller.
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
            {NETWORK.rpc}. Contract addresses are always re-fetched at runtime
            rather than hard coded, because venue ids move.
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
