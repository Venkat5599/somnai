"use client";

/**
 * Multi-leg execution, on screen.
 *
 * WHY THIS EXISTS. `sdk/dreamdex/batch.ts` shipped with no caller, while the
 * README said "the result carries which of the four it delivered, and the UI
 * prints it". Nothing printed it. This is that UI, and the guarantee it renders
 * is the raw `atomicity` field — never a boolean, never a green tick, and never
 * the word atomic, because the chain cannot give atomicity and saying otherwise
 * is the failure the module was written to prevent.
 *
 * The composition is deliberately not a wizard. A basket is a short list you
 * assemble and then commit, so it reads as a ledger: legs stacked in send
 * order, each carrying its own verdict once it has one. Send order matters and
 * is visible, because a batch that breaks does so at a specific leg and the
 * user needs to see which legs were already live when it did.
 */

import { useMemo, useState, useTransition } from "react";
import { Button, Chip, Note, cx } from "@/components/ui";
import { IconArrowOut, IconCheck, IconCross, IconInfo, IconLayers } from "@/components/icons";
import type { EventMarket, Outcome } from "@sdk/venue/types";
import type { Atomicity, BatchLeg, LegPlan } from "@sdk/dreamdex/atomicity";
import type { BasketPlan, BasketRun } from "./actions";
import { executeBasket, planBasket } from "./actions";

/**
 * How each verdict reads, in the user's terms.
 *
 * PARTIAL_EXPOSED is the one that matters and is styled to be impossible to
 * skim past: it means real size is still on, and the person reading has to act.
 */
const VERDICT: Record<Atomicity, { title: string; body: string; tone: "up" | "warn" | "down" | "muted" }> = {
  PREFLIGHT_ALL_OR_NOTHING: {
    title: "Refused whole — nothing was sent",
    body: "A leg could not be routed, so no signature was ever created. This is the all-or-nothing case, and it cost nothing.",
    tone: "muted",
  },
  SEQUENTIAL_VERIFIED: {
    title: "Every leg filled and verified",
    body: "Each leg was confirmed from its own receipt rather than the SDK's return value. The structure is open in full.",
    tone: "up",
  },
  PARTIAL_UNWOUND: {
    title: "A leg failed — the filled legs were sold back",
    body: "The structure did not open. Everything that had filled was unwound and each sale was verified from chain, so the position is flat.",
    tone: "warn",
  },
  PARTIAL_EXPOSED: {
    title: "A leg failed and an unwind failed — size is still on",
    body: "This is the case EIP-7702 would have prevented and this chain cannot. One or more legs are still open. Close them manually from the trade terminal.",
    tone: "down",
  },
};

interface Draft {
  market: EventMarket;
  outcome: Outcome;
  size: number;
}

export function BasketPanel({
  routable,
  explorer,
}: {
  routable: EventMarket[];
  explorer: string;
}) {
  const [draft, setDraft] = useState<Draft[]>([]);
  const [plan, setPlan] = useState<BasketPlan | null>(null);
  const [run, setRun] = useState<BasketRun | null>(null);
  const [pending, start] = useTransition();

  const legs: BatchLeg[] = useMemo(
    () =>
      draft.map((d) => ({
        marketId: d.market.marketId,
        outcome: d.outcome,
        side: "buy" as const,
        size: d.size,
        label: `${d.market.asset} ${d.market.interval} ${d.outcome}`,
      })),
    [draft],
  );

  // Any edit invalidates a plan priced against the previous basket. Showing a
  // stale cost next to a changed basket is how someone commits to the wrong
  // number.
  const edit = (next: Draft[]) => {
    setDraft(next);
    setPlan(null);
    setRun(null);
  };

  const add = (market: EventMarket, outcome: Outcome) => {
    if (draft.some((d) => d.market.marketId === market.marketId && d.outcome === outcome)) return;
    if (draft.length >= 4) return;
    edit([...draft, { market, outcome, size: 1 }]);
  };

  const verdict = run?.result ? VERDICT[run.result.atomicity] : null;

  return (
    <section className="mt-10">
      <h2 className="text-title-sm text-ink mb-1">Basket</h2>
      <p className="text-[13px] text-ink-3 mb-4 max-w-[68ch]">
        Two or more legs committed together. EIP-7702 would make this one
        transaction; this chain is pre-Prague, so the basket is refused whole
        before anything is signed, each leg goes out fill-or-kill, and whatever
        filled is sold back if a later leg fails.
      </p>

      {routable.length < 2 ? (
        <Note icon={<IconInfo size={14} />} tone="warn">
          <span className="font-medium text-ink">
            {routable.length === 0 ? "Nothing is routable" : "Only one market is routable"} right
            now.
          </span>{" "}
          A basket needs at least two legs. Windows are minutes long — the venue
          will list more shortly.
        </Note>
      ) : (
        <div className="grid gap-px bg-line border border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          {/* ---- pick legs ---- */}
          <div className="bg-surface p-5 min-w-0">
            <p className="text-label-xs uppercase text-ink-3 mb-3">
              Available legs · {routable.length} routable
            </p>
            <ul className="flex flex-col border border-line">
              {routable.map((m, i) => (
                <li
                  key={m.marketId}
                  className={cx(
                    "flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3",
                    i < routable.length - 1 && "border-b border-line-soft",
                  )}
                >
                  <span className="text-[13px] text-ink min-w-0 flex-1">
                    {m.asset} · {m.interval}
                    <span className="num text-[12px] text-ink-3 ml-2">
                      {m.strike?.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </span>
                  {(["YES", "NO"] as Outcome[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => add(m, o)}
                      disabled={pending || draft.length >= 4}
                      className={cx(
                        "num text-[12px] px-3 h-7 border transition-colors",
                        "border-line text-ink-3 hover:border-accent hover:text-accent",
                        "disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-3",
                      )}
                    >
                      + {o}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          {/* ---- the basket ---- */}
          <div className="bg-surface p-5 min-w-0 flex flex-col">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <p className="text-label-xs uppercase text-ink-3">Send order</p>
              <span className="num text-[12px] text-ink-4 inline-flex items-center gap-1.5">
                <IconLayers size={13} />
                {draft.length} / 4
              </span>
            </div>

            {draft.length === 0 ? (
              <p className="text-[13px] text-ink-4 border border-line px-3.5 py-6 text-center">
                Add two or more legs to build a basket.
              </p>
            ) : (
              <ul className="flex flex-col border border-line">
                {draft.map((d, i) => {
                  const p: LegPlan | undefined = plan?.plans[i];
                  const o = run?.result?.outcomes[i];
                  return (
                    <li
                      key={`${d.market.marketId}-${d.outcome}`}
                      className={cx(
                        "px-3.5 py-3",
                        i < draft.length - 1 && "border-b border-line-soft",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="num text-[12px] text-ink-4 w-5 shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[13px] text-ink min-w-0 flex-1 truncate">
                          {d.market.asset} {d.market.interval}{" "}
                          <span className={d.outcome === "YES" ? "text-up" : "text-down"}>
                            {d.outcome}
                          </span>
                        </span>
                        <input
                          type="number"
                          min={d.market.minAmount}
                          step={d.market.minAmount}
                          value={d.size}
                          disabled={pending}
                          onChange={(e) => {
                            const next = [...draft];
                            next[i] = { ...d, size: Number(e.target.value) };
                            edit(next);
                          }}
                          aria-label={`Size for leg ${i + 1}`}
                          className="num text-[12px] w-16 h-7 px-2 bg-base border border-line text-ink text-right focus:border-accent outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => edit(draft.filter((_, j) => j !== i))}
                          disabled={pending}
                          aria-label={`Remove leg ${i + 1}`}
                          className="text-ink-4 hover:text-down transition-colors p-1"
                        >
                          <IconCross size={13} />
                        </button>
                      </div>

                      {/* Per-leg verdict, once there is one to show. */}
                      {p && !p.ok ? (
                        <p className="text-[12px] text-warn mt-2 pl-8">
                          {p.blocker} — {p.detail}
                        </p>
                      ) : p?.ok && !o ? (
                        <p className="num text-[12px] text-ink-3 mt-2 pl-8">
                          crosses at {p.price?.toFixed(3)} · {p.cost?.toFixed(6)} tUSDC
                        </p>
                      ) : null}

                      {o ? (
                        <p
                          className={cx(
                            "num text-[12px] mt-2 pl-8 flex flex-wrap items-center gap-x-3 gap-y-1",
                            o.status === "FILLED" ? "text-up" : "text-ink-3",
                          )}
                        >
                          <span>
                            {o.status === "FILLED" ? "filled" : o.status.toLowerCase()}
                            {o.filled > 0 ? ` ${o.filled}` : ""}
                          </span>
                          {o.txHash ? (
                            <a
                              href={`${explorer}/tx/${o.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-accent hover:text-ink transition-colors"
                            >
                              {o.txHash.slice(0, 10)}…
                              <IconArrowOut size={11} />
                            </a>
                          ) : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {plan?.totalCost !== null && plan?.totalCost !== undefined ? (
              <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t border-line-soft">
                <span className="text-[13px] text-ink-3">Basket cost</span>
                <span className="num text-[13px] text-ink">
                  {plan.totalCost.toFixed(6)} tUSDC
                </span>
              </div>
            ) : null}

            {plan && !plan.ok ? (
              <p className="text-[12px] text-warn mt-3">{plan.reason}</p>
            ) : null}
            {run && !run.result ? (
              <p className="text-[12px] text-warn mt-3">{run.reason}</p>
            ) : null}

            <div className="mt-auto pt-5 flex gap-px bg-line">
              <Button
                variant="ghost"
                size="md"
                block
                disabled={draft.length < 2 || pending}
                onClick={() =>
                  start(async () => {
                    setRun(null);
                    setPlan(await planBasket(legs));
                  })
                }
              >
                {pending && !plan ? "Pricing…" : "Price basket"}
              </Button>
              <Button
                variant="primary"
                size="md"
                block
                disabled={!plan?.ok || pending || !!run}
                onClick={() =>
                  start(async () => {
                    setRun(await executeBasket(legs));
                  })
                }
              >
                {pending && plan ? "Sending…" : "Open basket"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- the guarantee actually delivered ---- */}
      {verdict && run?.result ? (
        <div className="mt-6">
          <Note
            icon={verdict.tone === "up" ? <IconCheck size={14} /> : <IconInfo size={14} />}
            tone={verdict.tone === "down" ? "warn" : verdict.tone === "up" ? "accent" : "warn"}
          >
            <span className="font-medium text-ink">{verdict.title}</span>{" "}
            {verdict.body}
            <span className="block mt-2 num text-[11px] text-ink-4">
              {run.result.atomicity} · {run.result.elapsedMs}ms ·{" "}
              {run.result.eip7702Available
                ? "EIP-7702 available on this chain"
                : "EIP-7702 unavailable on this chain"}
            </span>
          </Note>

          {run.result.unwinds.length ? (
            <ul className="mt-4 flex flex-col border border-line bg-surface">
              {run.result.unwinds.map((u, i) => (
                <li
                  key={i}
                  className={cx(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3 text-[12px]",
                    i < run.result!.unwinds.length - 1 && "border-b border-line-soft",
                  )}
                >
                  <Chip tone={u.status === "UNWOUND" ? "up" : "down"}>
                    {u.status === "UNWOUND" ? "unwound" : "unwind failed"}
                  </Chip>
                  <span className="num text-ink-2">
                    {u.leg.label ?? u.leg.marketId.slice(0, 10)} · {u.size}
                  </span>
                  {u.detail ? <span className="text-ink-3">{u.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
