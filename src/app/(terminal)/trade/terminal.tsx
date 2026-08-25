"use client";

/**
 * The trading terminal.
 *
 * Three docked regions separated by a single structural line: market context,
 * the builder, and execution. Every number on the right is derived from the
 * same replication the left panel describes, so the ticket and the diagram can
 * never disagree.
 */

import { useCallback, useMemo, useState } from "react";
import { PayoffChart } from "@/components/charts";
import { StrikeBand } from "@/components/strike-band";
import { useReplication } from "@/components/use-replication";
import { TICK, LOT } from "@/lib/venue";
import {
  Button,
  Chip,
  KV,
  Note,
  PanelBody,
  PanelHeader,
  Segmented,
  cx,
} from "@/components/ui";
import {
  IconBolt,
  IconInfo,
  IconLayers,
  IconRedo,
  IconUndo,
} from "@/components/icons";
import {
  depthMapFor,
  EXPIRY_OPTIONS,
  ladderFor,
  SPOT,
  strikeAt,
  type ExpiryLabel,
} from "@/lib/data";
import {
  fmtProb,
  fmtSignedPct,
  fmtUsd,
  headroomSec,
  type StructureKind,
} from "@/lib/quant";

/** Seconds read badly past a couple of minutes; switch units at 120s. */
function formatHeadroom(sec: number): string {
  if (sec < 120) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

const KINDS: { value: StructureKind; label: string }[] = [
  { value: "DIRECTIONAL", label: "Directional" },
  { value: "RANGE", label: "Range" },
  { value: "SPREAD", label: "Spread" },
  { value: "LADDER", label: "Ladder" },
  { value: "CALENDAR", label: "Calendar" },
];

interface Snapshot {
  asset: "BTC" | "ETH";
  expiry: ExpiryLabel;
  kind: StructureKind;
  lower: number;
  upper: number;
  size: number;
}

const INITIAL: Snapshot = {
  asset: "BTC",
  expiry: "4h",
  kind: "RANGE",
  lower: strikeAt("BTC", "4h", -2),
  upper: strikeAt("BTC", "4h", 2),
  size: 100,
};

export function TradeTerminal() {
  const [past, setPast] = useState<Snapshot[]>([]);
  const [state, setState] = useState<Snapshot>(INITIAL);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [staged, setStaged] = useState(false);
  // No receipt state. Execution against the venue is not wired yet, and this
  // component previously fabricated a transaction hash from Date.now() and
  // rendered it as "Executed" / "CONFIRMED". Inventing chain state is worse
  // than having no execution at all, so the control now reports the truth.

  const commit = useCallback(
    (next: Partial<Snapshot>) => {
      setPast((p) => [...p.slice(-24), state]);
      setFuture([]);
      setStaged(false);

      setState((s) => ({ ...s, ...next }));
    },
    [state],
  );

  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [state, ...f]);
    setState(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setStaged(false);

  };

  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, state]);
    setState(future[0]);
    setFuture((f) => f.slice(1));
    setStaged(false);

  };

  const single = state.kind === "DIRECTIONAL" || state.kind === "CALENDAR";

  const ladder = useMemo(
    () => ladderFor(state.asset, state.expiry),
    [state.asset, state.expiry],
  );
  const depth = useMemo(
    () => depthMapFor(state.asset, state.expiry),
    [state.asset, state.expiry],
  );
  const strikes = ladder.map((r) => r.strike);

  const rep = useReplication({
    asset: state.asset,
    expiry: state.expiry,
    kind: state.kind,
    lower: state.lower,
    upper: single ? state.lower : state.upper,
    size: state.size,
  });

  const spot = SPOT[state.asset];
  const intervalSec =
    EXPIRY_OPTIONS.find((e) => e.label === state.expiry)?.intervalSec ?? 3600;

  const thin = rep.fillRatio < 0.995;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      {/* ---------------------------------------------------------- */}
      {/* MARKET                                                     */}
      {/* ---------------------------------------------------------- */}
      <section aria-label="Market" className="flex flex-col min-h-0 xl:border-r border-b xl:border-b-0 border-line overflow-y-auto">
        <PanelHeader title="Market">
          <Chip tone="up" live>
            Trading
          </Chip>
        </PanelHeader>

        <PanelBody className="flex flex-col gap-6">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-title-sm text-ink">{state.asset} / USD</span>
              <span
                className={cx(
                  "num text-[13px]",
                  spot.change >= 0 ? "text-up" : "text-down",
                )}
              >
                {fmtSignedPct(spot.change)}
              </span>
            </div>
            <p className="num text-[30px] leading-[36px] text-accent mt-2 tracking-tight">
              {fmtUsd(spot.price)}
            </p>
            <p className="text-[12px] text-ink-3 mt-1.5">
              24h volume{" "}
              <span className="num text-ink-2">
                ${(spot.vol / 1e9).toFixed(2)}B
              </span>
            </p>
          </div>

          <div>
            <p className="text-label-xs uppercase text-ink-3 mb-2.5">Underlying</p>
            <Segmented
              label="Underlying asset"
              options={[
                { value: "BTC" as const, label: "BTC" },
                { value: "ETH" as const, label: "ETH" },
              ]}
              value={state.asset}
              onChange={(asset) => {
                const l = ladderFor(asset, state.expiry);
                const mid = l[Math.floor(l.length / 2)].strike;
                const hi = l[Math.min(Math.floor(l.length / 2) + 3, l.length - 1)].strike;
                commit({ asset, lower: mid, upper: hi });
              }}
            />
          </div>

          <div>
            <p className="text-label-xs uppercase text-ink-3 mb-2.5">Window</p>
            <Segmented
              label="Expiry window"
              columns={3}
              options={EXPIRY_OPTIONS.map((e) => ({
                value: e.label,
                label: e.label,
              }))}
              value={state.expiry}
              onChange={(expiry) => commit({ expiry })}
            />
            <p className="text-[11px] text-ink-4 mt-2 leading-[16px]">
              Orders carry {formatHeadroom(headroomSec(intervalSec))} of expiry
              headroom, scaled to the {state.expiry} window rather than a fixed
              threshold.
            </p>
          </div>

          <div>
            <p className="text-label-xs uppercase text-ink-3 mb-2.5">Structure</p>
            <Segmented
              label="Structure kind"
              columns={2}
              options={KINDS}
              value={state.kind}
              onChange={(kind) => {
                const nowSingle = kind === "DIRECTIONAL" || kind === "CALENDAR";
                commit({
                  kind,
                  upper: nowSingle
                    ? state.lower
                    : Math.max(state.upper, state.lower + (strikes[1] - strikes[0])),
                });
              }}
            />
          </div>

          <div>
            <p className="text-label-xs uppercase text-ink-3 mb-2.5">Size</p>
            <div className="flex items-stretch border border-line focus-within:border-accent transition-colors">
              <input
                type="number"
                min={LOT}
                step={LOT}
                value={state.size}
                onChange={(e) =>
                  commit({ size: Math.max(LOT, Number(e.target.value) || LOT) })
                }
                aria-label="Contracts at peak payoff"
                className="num flex-1 min-w-0 h-9 bg-base px-2.5 text-[13px] text-ink outline-none"
              />
              <span className="flex items-center px-2.5 border-l border-line text-label-xs uppercase text-ink-4">
                contracts
              </span>
            </div>
          </div>
        </PanelBody>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* BUILDER                                                    */}
      {/* ---------------------------------------------------------- */}
      <section aria-label="Builder" className="flex flex-col min-h-0 border-b xl:border-b-0 border-line overflow-y-auto min-w-0">
        <PanelHeader title="Build your view">
          <button
            type="button"
            onClick={undo}
            disabled={!past.length}
            aria-label="Undo"
            className="text-ink-3 hover:text-ink disabled:text-ink-4 disabled:hover:text-ink-4 transition-colors p-1"
          >
            <IconUndo size={15} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!future.length}
            aria-label="Redo"
            className="text-ink-3 hover:text-ink disabled:text-ink-4 disabled:hover:text-ink-4 transition-colors p-1"
          >
            <IconRedo size={15} />
          </button>
        </PanelHeader>

        <PanelBody className="flex flex-col gap-7 min-w-0">
          <StrikeBand
            strikes={strikes}
            depth={depth}
            lower={state.lower}
            upper={single ? state.lower : state.upper}
            single={single}
            spot={spot.price}
            onChange={(lo, hi) => commit({ lower: lo, upper: single ? lo : hi })}
          />

          <PayoffChart
            curve={rep.curve}
            breakevens={rep.breakevens}
            spot={spot.price}
            band={single ? undefined : [state.lower, state.upper]}
            height={296}
          />

          <section className="border border-line">
            <div className="flex items-center justify-between h-10 px-3 border-b border-line">
              <span className="text-label-xs uppercase text-ink-3">
                PRISM decomposition
              </span>
              <span className="inline-flex items-center gap-1.5 text-label-xs uppercase text-ink-4">
                <IconLayers size={13} />
                {rep.legs.length} {rep.legs.length === 1 ? "leg" : "legs"}
              </span>
            </div>

            <div className="w-full overflow-x-auto">
              <table className="w-full border-collapse min-w-[520px]">
                <thead>
                  <tr>
                    {["Leg", "Side", "Strike", "Weight", "Price", "Depth", "Cash"].map(
                      (h, i) => (
                        <th
                          key={h}
                          scope="col"
                          className={cx(
                            "text-label-xs uppercase text-ink-3 font-semibold px-3 h-8 border-b border-line whitespace-nowrap",
                            i >= 3 ? "text-right" : "text-left",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rep.legs.map((l, i) => (
                    <tr key={`${l.strike}-${l.side}-${i}`} className="hover:bg-surface-2 transition-colors">
                      <td className="num px-3 h-9 text-[12px] text-ink-3 border-b border-line-soft">
                        {String(i + 1).padStart(2, "0")}
                      </td>
                      <td className="px-3 h-9 border-b border-line-soft">
                        <span
                          className={cx(
                            "text-[12px] uppercase tracking-[0.05em]",
                            l.weight >= 0 ? "text-up" : "text-down",
                          )}
                        >
                          {l.weight >= 0 ? "Long" : "Short"} {l.side}
                        </span>
                      </td>
                      <td className="num px-3 h-9 text-[12px] text-ink border-b border-line-soft">
                        {l.strike.toLocaleString("en-US")}
                      </td>
                      <td className="num px-3 h-9 text-[12px] text-right text-ink border-b border-line-soft">
                        {l.weight >= 0 ? "+" : ""}
                        {l.weight.toFixed(0)}
                      </td>
                      <td className="num px-3 h-9 text-[12px] text-right text-ink-2 border-b border-line-soft">
                        {fmtProb(l.price)}
                      </td>
                      <td className="num px-3 h-9 text-[12px] text-right text-ink-3 border-b border-line-soft">
                        {l.depth.toLocaleString("en-US")}
                      </td>
                      <td
                        className={cx(
                          "num px-3 h-9 text-[12px] text-right border-b border-line-soft",
                          l.weight * l.price >= 0 ? "text-down" : "text-up",
                        )}
                      >
                        {l.weight * l.price >= 0 ? "-" : "+"}
                        {fmtUsd(Math.abs(l.weight * l.price)).replace("$", "$")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Note icon={<IconInfo size={14} />} tone="neutral">
            Every price is quantised to the venue tick grid of {TICK} in integer
            tick units before signing. Converting a float probability with
            parseUnits lands a few wei off the grid and the pool rejects the
            order with InvalidPrice.
          </Note>
        </PanelBody>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* EXECUTION                                                  */}
      {/* ---------------------------------------------------------- */}
      <section aria-label="Execution" className="flex flex-col min-h-0 xl:border-l border-line overflow-y-auto">
        <PanelHeader title="Execution">
          <IconBolt size={14} className="text-accent" />
        </PanelHeader>

        <PanelBody className="flex flex-col h-full">
          <div>
            <KV k="Net premium" v={fmtUsd(rep.cost)} />
            <KV k="Max payout" v={fmtUsd(rep.maxPayout)} tone="accent" />
            <KV
              k="Potential return"
              v={fmtSignedPct(rep.potentialReturn)}
              tone={rep.potentialReturn >= 0 ? "up" : "down"}
            />
            <KV
              k="Est. slippage"
              v={`${(rep.slippage * 100).toFixed(2)}%`}
              tone={thin ? "down" : undefined}
            />
            <KV k="Available liquidity" v={fmtUsd(rep.availableLiquidity, 0)} />
            <KV
              k="Breakeven"
              v={
                rep.breakevens.length
                  ? rep.breakevens
                      .map((b) => Math.round(b).toLocaleString("en-US"))
                      .join(" / ")
                  : "—"
              }
              tone="muted"
            />
          </div>

          <div className="mt-5 flex flex-col gap-3">
            <Note icon={<IconBolt size={14} />} tone="accent">
              All {rep.legs.length} legs land in one EIP-7702 batch, so the
              structure either opens whole or not at all. No leg risk between
              fills.
            </Note>

            {thin ? (
              <Note tone="warn" icon={<IconInfo size={14} />}>
                The book can only absorb {(rep.fillRatio * 100).toFixed(1)}% of
                this size at these strikes. Size has been scaled down to what is
                actually resting.
              </Note>
            ) : null}
          </div>

          {/* Actions anchored to the bottom of the panel so the ticket reads
              the same whatever the notes above it are doing. */}
          <div className="mt-auto pt-6 flex flex-col gap-2">
            <Note tone="warn" icon={<IconInfo size={14} />}>
              <span className="font-medium text-ink">
                Execution not connected.
              </span>{" "}
              The replication above is real and computed from the live ladder,
              but PRISM cannot yet submit it to the venue. This control is
              disabled rather than reporting a result it did not produce.
            </Note>

            <Button
              variant="ghost"
              size="lg"
              block
              onClick={() => setStaged((v) => !v)}
              aria-pressed={staged}
            >
              {staged ? "Preview staged" : "Preview trade"}
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              disabled
              leading={<IconBolt size={15} />}
              title="Live Event Contract execution is being integrated"
            >
              Execution unavailable
            </Button>
            <p className="text-[11px] leading-[16px] text-ink-4 text-center">
              Live Event Contract execution is being integrated. No transaction
              is signed, sent, or simulated here.
            </p>
          </div>
        </PanelBody>
      </section>
    </div>
  );
}
