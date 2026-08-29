"use client";

/**
 * The trading terminal.
 *
 * ONE SOURCE OF TRUTH: the bound `market`. Everything on screen — header,
 * strike, expiry, payoff, execution — is derived from it or from the real order
 * book beside it.
 *
 * The previous version ran two disconnected state systems: the venue market on
 * one side, and a leftover fixture builder (its own asset, window, strike band)
 * on the other. They never reconciled, so the header could read ETH·1m while
 * the selectors read BTC·5M and the breakevens were BTC-scale. That is not a
 * cosmetic bug — it makes the product look like it does not know what it is
 * trading. Asset and window are now NAVIGATION: picking one binds a different
 * real market, it does not mutate a parallel model.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PriceChart } from "@/components/price-chart";
import { Chip, Note, PanelBody, PanelHeader, cx } from "@/components/ui";
import {
  IconArrowRight,
  IconBolt,
  IconInfo,
  IconLayers,
  IconRoll,
} from "@/components/icons";
import { headroomSec, type Asset, type EventMarket, type Outcome } from "@sdk/venue/types";
import type { PriceSnapshot } from "@sdk/venue/prices";
import type { MarketBook } from "./page";
import { ExecutePanel } from "./execute-panel";
import { useCountdown, expiryPhase, type ExpiryPhase } from "./use-countdown";

/**
 * Structures the venue can express.
 *
 * Range, Spread and Ladder each need two or more strikes on ONE expiry, and the
 * venue lists exactly one strike per window. They are shown LOCKED with the
 * reason rather than as a warning banner — a locked control explains itself in
 * place and costs no vertical space.
 */
const STRUCTURES = [
  { id: "DIRECTIONAL", label: "Directional", live: true, why: "One contract, one leg." },
  { id: "CALENDAR", label: "Calendar", live: true, why: "One strike carried across succession." },
  { id: "RANGE", label: "Range", live: false, why: "Needs two strikes on one expiry." },
  { id: "SPREAD", label: "Spread", live: false, why: "Needs two strikes on one expiry." },
  { id: "LADDER", label: "Ladder", live: false, why: "Needs several strikes on one expiry." },
] as const;

type StructureId = (typeof STRUCTURES)[number]["id"];

export function TradeTerminal({
  market,
  routable,
  active,
  succession,
  book,
  prices,
  requestedId,
  venueError,
}: {
  market: EventMarket | null;
  routable: EventMarket[];
  active: EventMarket[];
  succession: EventMarket[];
  book: MarketBook;
  prices: PriceSnapshot | null;
  requestedId: string | null;
  venueError: string | null;
}) {
  const router = useRouter();
  const [structure, setStructure] = useState<StructureId>("DIRECTIONAL");
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [view, setView] = useState<"payoff" | "market">("payoff");

  const now = useCountdown();
  const left = market ? market.expiry - now : 0;
  const phase: ExpiryPhase = market
    ? expiryPhase(left, headroomSec(market.intervalSec))
    : "none";

  /** Navigate to the real market for an asset/cadence, or nothing if unlisted. */
  const bind = (asset: Asset, intervalSec: number) => {
    const target =
      active.find((m) => m.asset === asset && m.intervalSec === intervalSec) ?? null;
    if (target) router.push(`/trade?market=${encodeURIComponent(target.marketId)}`);
  };

  const side = book[outcome];

  // Cadences come from the live board, never a hardcoded table. The venue
  // started listing 60s windows after this UI was written, and a fixed list
  // left the selector with NOTHING highlighted on a 1m market — the control
  // could not represent the market it was bound to.
  const cadences = useMemo(() => {
    const seen = new Map<number, string>();
    for (const m of active) if (!seen.has(m.intervalSec)) seen.set(m.intervalSec, m.interval);
    return [...seen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sec, label]) => ({ sec, label }));
  }, [active]);

  if (!market) {
    return (
      <div className="flex-1 min-h-0 p-6">
        <Note tone="warn" icon={<IconInfo size={14} />}>
          <span className="font-medium text-ink">
            {venueError
              ? "Venue unreachable."
              : requestedId
                ? "Market not found."
                : "No routable market."}
          </span>{" "}
          {venueError
            ? "The indexer did not answer, so no market is bound."
            : requestedId
              ? "That market id is not in the current registry — windows expire and are replaced continuously."
              : "The venue has no routable Event Contract right now."}
          <span className="block mt-3">
            <Link
              href="/markets"
              className="text-accent hover:text-ink transition-colors text-[13px]"
            >
              Browse live markets →
            </Link>
          </span>
        </Note>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[288px_minmax(0,1fr)_320px]">
      {/* ============================ MARKET ============================ */}
      <section
        aria-label="Market"
        className="flex flex-col min-h-0 xl:border-r border-b xl:border-b-0 border-line overflow-y-auto"
      >
        <PanelHeader title="Market">
          <ExpiryChip phase={phase} left={left} />
        </PanelHeader>

        <PanelBody className="flex flex-col gap-5">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-title-sm text-ink">
                {market.asset} / USD
              </span>
              <span className="num text-[12px] text-ink-3">{market.interval}</span>
            </div>
            <p className="num text-[28px] leading-[34px] text-accent mt-2 tracking-tight">
              {market.strike !== null
                ? market.strike.toLocaleString("en-US", { minimumFractionDigits: 2 })
                : "unstruck"}
            </p>
            <p className="text-[12px] text-ink-3 mt-1">Strike</p>
          </div>

          <ExpiryBlock market={market} left={left} phase={phase} succession={succession} />

          <Selector
            label="Underlying"
            options={(["BTC", "ETH"] as Asset[]).map((a) => ({
              key: a,
              label: a,
              on: a === market.asset,
              enabled: active.some(
                (m) => m.asset === a && m.intervalSec === market.intervalSec,
              ),
            }))}
            onPick={(a) => bind(a as Asset, market.intervalSec)}
            columns={2}
          />

          <Selector
            label="Window"
            options={cadences.map((c) => ({
              key: String(c.sec),
              label: c.label,
              on: c.sec === market.intervalSec,
              enabled: active.some(
                (m) => m.asset === market.asset && m.intervalSec === c.sec,
              ),
            }))}
            onPick={(k) => bind(market.asset, Number(k))}
            columns={3}
          />

          <div>
            <p className="text-label-xs uppercase text-ink-3 mb-2">Structure</p>
            <div className="grid grid-cols-2 gap-px bg-line border border-line">
              {STRUCTURES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!s.live}
                  title={s.why}
                  aria-pressed={s.id === structure}
                  onClick={() => s.live && setStructure(s.id)}
                  className={cx(
                    "flex flex-col items-start gap-0.5 px-2.5 py-2 text-left transition-colors",
                    !s.live
                      ? "bg-base text-ink-4 cursor-not-allowed"
                      : s.id === structure
                        ? "bg-[#2b2115] text-accent"
                        : "bg-surface text-ink-3 hover:text-ink hover:bg-surface-2",
                  )}
                >
                  <span className="text-[12px] uppercase tracking-[0.05em]">
                    {s.label}
                  </span>
                  <span
                    className={cx(
                      "text-[9px] uppercase tracking-[0.1em]",
                      s.live ? "text-ink-4" : "text-ink-4",
                    )}
                  >
                    {s.live ? "live" : "locked"}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-[15px] text-ink-4 mt-2">
              {STRUCTURES.find((s) => s.id === structure)?.why}{" "}
              Locked structures need more than one strike on a single expiry.
            </p>
          </div>
        </PanelBody>
      </section>

      {/* ============================ CENTER ============================ */}
      <section
        aria-label="Analysis"
        className="flex flex-col min-h-0 border-b xl:border-b-0 border-line overflow-y-auto min-w-0"
      >
        <PanelHeader title={view === "payoff" ? "Your payoff" : "Oracle price"}>
          <div className="flex items-stretch border border-line h-7">
            {(["payoff", "market"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === view}
                onClick={() => setView(v)}
                className={cx(
                  "px-2.5 text-[11px] uppercase tracking-[0.05em] transition-colors",
                  v === view
                    ? "bg-[#2b2115] text-accent"
                    : "text-ink-3 hover:text-ink hover:bg-surface-2",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </PanelHeader>

        <PanelBody className="flex flex-col gap-6 min-w-0">
          {view === "payoff" ? (
            <BinaryPayoff
              market={market}
              outcome={outcome}
              price={side.best}
              live={prices?.live?.price ?? null}
            />
          ) : prices ? (
            <PriceChart
              candles={prices.candles}
              live={prices.live}
              asset={market.asset}
              timeframe={prices.timeframe}
              strike={market.strike}
              height={300}
            />
          ) : (
            <p className="text-[12px] text-ink-3">Oracle feed unavailable.</p>
          )}

          <Continuity market={market} succession={succession} now={now} />
        </PanelBody>
      </section>

      {/* =========================== EXECUTION =========================== */}
      <section
        aria-label="Execution"
        className="flex flex-col min-h-0 xl:border-l border-line overflow-y-auto"
      >
        <PanelHeader title="Execution">
          <IconBolt size={14} className="text-accent" />
        </PanelHeader>
        <PanelBody className="flex flex-col h-full">
          <ExecutePanel
            market={market}
            side={side}
            otherSide={book[outcome === "YES" ? "NO" : "YES"]}
            outcome={outcome}
            onOutcome={setOutcome}
            phase={phase}
            left={left}
            structure={structure}
          />
        </PanelBody>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Expiry                                                              */
/* ------------------------------------------------------------------ */

function ExpiryChip({ phase, left }: { phase: ExpiryPhase; left: number }) {
  if (phase === "expired")
    return <Chip tone="down">Expired</Chip>;
  if (phase === "imminent")
    return <Chip tone="down" live>{left}s left</Chip>;
  if (phase === "closing")
    return <Chip tone="warn" live>Closing</Chip>;
  return <Chip tone="up" live>Trading</Chip>;
}

function ExpiryBlock({
  market,
  left,
  phase,
  succession,
}: {
  market: EventMarket;
  left: number;
  phase: ExpiryPhase;
  succession: EventMarket[];
}) {
  const next = succession.find((m) => m.expiry > market.expiry) ?? null;
  const mmss = (s: number) =>
    `${String(Math.floor(Math.max(s, 0) / 60)).padStart(2, "0")}:${String(Math.max(s, 0) % 60).padStart(2, "0")}`;

  if (phase === "expired") {
    return (
      <div className="border border-[#2a2a2a] bg-[#1f1d1a] p-3">
        <p className="text-label-xs uppercase text-down">Market expired</p>
        <p className="text-[12px] leading-[17px] text-ink-2 mt-1.5">
          This window is no longer executable.
        </p>
        {next ? (
          <Link
            href={`/trade?market=${encodeURIComponent(next.marketId)}`}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
          >
            Go to next window
            <IconArrowRight size={13} />
          </Link>
        ) : (
          <p className="text-[11px] text-ink-4 mt-2">
            Successor not yet struck by the venue.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "border p-3",
        phase === "imminent"
          ? "border-[#2a2a2a] bg-[#1f1d1a]"
          : phase === "closing"
            ? "border-[#2a2a2a] bg-[#1f1d1a]"
            : "border-line bg-surface-2",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label-xs uppercase text-ink-3">
          {phase === "imminent" ? "Expiry imminent" : "Closes in"}
        </span>
        <span
          className={cx(
            "num text-[20px] leading-[24px]",
            phase === "imminent" ? "text-down" : phase === "closing" ? "text-warn" : "text-ink",
          )}
        >
          {mmss(left)}
        </span>
      </div>
      {phase !== "open" ? (
        <p className="text-[11px] leading-[15px] text-ink-3 mt-1.5">
          Orders must land before expiry. Headroom for a {market.interval} window
          is {headroomSec(market.intervalSec)}s.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payoff — real, from the real book price                             */
/* ------------------------------------------------------------------ */

/**
 * A binary's payoff needs no model.
 *
 * Buying an outcome at probability p costs p per contract and returns exactly
 * 1 if it resolves that way, 0 otherwise. So the whole diagram is determined by
 * the strike and the price actually resting on the book — no generated ladder,
 * no fitted vol.
 */
function BinaryPayoff({
  market,
  outcome,
  price,
  live,
}: {
  market: EventMarket;
  outcome: Outcome;
  price: number | null;
  live: number | null;
}) {
  const W = 660;
  const H = 260;
  const PAD = { t: 26, r: 30, b: 34, l: 46 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const k = market.strike;
  if (k === null || price === null) {
    // A dead end is a UX failure, not an honest empty state. Say what is wrong
    // AND where to go — the other outcome often has a book when this one does
    // not, and /markets shows which windows are routable right now.
    return (
      <div className="border border-line bg-base p-8 text-center">
        <p className="text-[13px] text-ink-2">
          {k === null
            ? "This window has no strike yet, so it has no payoff."
            : `No resting offer on ${outcome} — nothing to price against.`}
        </p>
        {k !== null ? (
          <p className="text-[12px] text-ink-3 mt-2 max-w-[52ch] mx-auto">
            Books on this venue are frequently one-sided. Try{" "}
            <span className="text-ink-2">{outcome === "YES" ? "NO" : "YES"}</span>,
            or pick a window that is quoting.
          </p>
        ) : null}
        <Link
          href="/markets"
          className="mt-4 inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.05em] text-accent hover:text-ink transition-colors"
        >
          Browse routable markets
          <IconArrowRight size={13} />
        </Link>
      </div>
    );
  }

  // Domain: a band around the strike wide enough to show both regimes.
  const span = Math.max(k * 0.004, 1);
  const x0 = k - span;
  const x1 = k + span;
  const X = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * iw;

  const win = 1 - price; // profit per contract if it resolves your way
  const lose = -price;
  const yMax = Math.max(win, 0.02);
  const yMin = Math.min(lose, -0.02);
  const Y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * ih;

  // YES pays above the strike; NO pays at or below it.
  const leftPnl = outcome === "YES" ? lose : win;
  const rightPnl = outcome === "YES" ? win : lose;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <span className="text-[13px] text-ink">
          {market.asset} <span className="text-accent">{outcome}</span> at{" "}
          <span className="num">{k.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
        </span>
        <span className="num text-[12px] text-ink-3">
          {(price * 100).toFixed(1)}% implied
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block border border-line bg-base"
        role="img"
        aria-label={`Payoff for ${outcome} at strike ${k}: ${win.toFixed(3)} per contract if it resolves ${outcome}, ${lose.toFixed(3)} otherwise.`}
      >
        <g stroke="#2a2724" strokeWidth="1" strokeDasharray="2 4">
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={PAD.l} y1={PAD.t + ih * f} x2={PAD.l + iw} y2={PAD.t + ih * f} />
          ))}
        </g>

        {/* zero line */}
        <line x1={PAD.l} y1={Y(0)} x2={PAD.l + iw} y2={Y(0)} stroke="#3f3a35" strokeWidth="1" />

        {/* the step */}
        <path
          d={`M${PAD.l} ${Y(leftPnl)} L${X(k)} ${Y(leftPnl)} L${X(k)} ${Y(rightPnl)} L${PAD.l + iw} ${Y(rightPnl)}`}
          fill="none"
          stroke="#e0a33f"
          strokeWidth="1.5"
          strokeLinejoin="miter"
        />

        {/* strike */}
        <line
          x1={X(k)}
          y1={PAD.t}
          x2={X(k)}
          y2={PAD.t + ih}
          stroke="#e0a33f"
          strokeWidth="1"
          strokeOpacity="0.4"
          strokeDasharray="3 3"
        />
        <text x={X(k)} y={PAD.t - 8} fill="#e0a33f" fontSize="9.5" fontWeight="600" textAnchor="middle" letterSpacing="0.08em">
          STRIKE
        </text>

        {/* live oracle */}
        {live !== null && live > x0 && live < x1 ? (
          <>
            <line x1={X(live)} y1={PAD.t} x2={X(live)} y2={PAD.t + ih} stroke="#877f75" strokeWidth="1" strokeDasharray="2 3" />
            <text x={X(live)} y={PAD.t + ih + 22} fill="#877f75" fontSize="9" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace">
              {live.toFixed(2)}
            </text>
          </>
        ) : null}

        <g fill="#877f75" fontSize="9.5" fontFamily="var(--font-geist-mono), monospace">
          <text x={PAD.l - 8} y={Y(win) + 3} textAnchor="end">+{win.toFixed(2)}</text>
          <text x={PAD.l - 8} y={Y(lose) + 3} textAnchor="end">{lose.toFixed(2)}</text>
        </g>
      </svg>

      <p className="text-[11px] text-ink-4 mt-2">
        Per contract. Settles at 1 if {market.asset} is{" "}
        {outcome === "YES" ? "above" : "at or below"} the strike when the window
        closes, 0 otherwise.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Continuity — the thesis, in the terminal                            */
/* ------------------------------------------------------------------ */

function Continuity({
  market,
  succession,
  now,
}: {
  market: EventMarket;
  succession: EventMarket[];
  now: number;
}) {
  const idx = succession.findIndex((m) => m.marketId === market.marketId);
  const chain = idx >= 0 ? succession.slice(idx, idx + 4) : succession.slice(0, 4);
  const upcoming = Math.max(chain.length - 1, 0);
  const horizonMin = Math.round((chain.length * market.intervalSec) / 60);

  return (
    <section className="border border-line">
      <header className="flex items-center justify-between h-10 px-3 border-b border-line">
        <span className="inline-flex items-center gap-2 text-label-xs uppercase text-ink-3">
          <IconRoll size={13} className="text-accent" />
          PRISM continuity
        </span>
        <span className="num text-[11px] text-ink-4">
          {upcoming > 0 ? `horizon ≈ ${horizonMin}m` : "awaiting successor"}
        </span>
      </header>

      <div className="flex items-stretch overflow-x-auto p-3">
        {chain.map((m, i) => {
          const isNow = m.marketId === market.marketId;
          const left = m.expiry - now;
          return (
            <div key={m.marketId} className="flex items-stretch shrink-0">
              <div
                className={cx(
                  "w-[146px] border p-2.5 flex flex-col gap-1",
                  isNow ? "border-[#3f3a35] bg-[#1f1a13]" : "border-line bg-surface-2",
                )}
              >
                <span className="text-label-xs uppercase text-ink-4">
                  {isNow ? "current" : `+${i}`}
                </span>
                <span className="num text-[13px] text-ink">
                  {m.strike !== null
                    ? m.strike.toLocaleString("en-US", { minimumFractionDigits: 2 })
                    : "unstruck"}
                </span>
                <span className="num text-[11px] text-ink-3">
                  {left > 0
                    ? `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`
                    : "closed"}
                </span>
              </div>
              {i < chain.length - 1 ? (
                <span aria-hidden className="self-center px-2 num text-[12px] text-ink-4">
                  →
                </span>
              ) : null}
            </div>
          );
        })}

        {/* The venue strikes each successor only as the previous window nears
            close, so an empty slot is the NORMAL state, not a gap. Drawing it
            as a pending placeholder keeps the mechanism legible instead of
            leaving one lonely box that reads like the chain is broken. */}
        {upcoming === 0 ? (
          <>
            <span aria-hidden className="self-center px-2 num text-[12px] text-ink-4">
              →
            </span>
            <div className="w-[146px] border border-dashed border-line-strong p-2.5 flex flex-col gap-1 shrink-0">
              <span className="text-label-xs uppercase text-ink-4">next</span>
              <span className="text-[13px] text-ink-4">pending</span>
              <span className="text-[11px] text-ink-4">struck at close</span>
            </div>
          </>
        ) : null}
      </div>

      <p className="text-[11px] leading-[15px] text-ink-4 px-3 pb-3">
        A {market.interval} window is not a tenor. PRISM carries one view across
        successive windows — that is the product.{" "}
        <Link href="/roll" className="text-accent hover:text-ink transition-colors">
          Roll Engine →
        </Link>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Selector({
  label,
  options,
  onPick,
  columns,
}: {
  label: string;
  options: { key: string; label: string; on: boolean; enabled: boolean }[];
  onPick: (key: string) => void;
  columns: number;
}) {
  return (
    <div>
      <p className="text-label-xs uppercase text-ink-3 mb-2">{label}</p>
      <div
        className="grid gap-px bg-line border border-line"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(max-content,1fr))` }}
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={!o.enabled}
            aria-pressed={o.on}
            title={o.enabled ? undefined : "Venue has no live market for this combination"}
            onClick={() => o.enabled && onPick(o.key)}
            className={cx(
              "h-9 px-3 text-[12px] uppercase tracking-[0.05em] transition-colors",
              !o.enabled
                ? "bg-base text-ink-4 cursor-not-allowed"
                : o.on
                  ? "bg-[#2b2115] text-accent"
                  : "bg-surface text-ink-3 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { IconLayers };
