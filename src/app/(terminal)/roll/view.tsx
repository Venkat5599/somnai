"use client";

/**
 * The Roll Engine.
 *
 * Event Contract markets die on schedule and respawn. A five minute window is
 * not a tenor. This screen is where a stream of micro windows becomes a
 * position with a tenor the trader chose: each expiry, the engine re-strikes
 * into the successor market and carries the structure forward.
 */

import { useEffect, useState } from "react";
import {
  DemoData,
  Button,
  Chip,
  KV,
  Note,
  PageHead,
  Stat,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import { IconBolt, IconInfo, IconRoll } from "@/components/icons";
import { ROLL_QUEUE } from "@/lib/data";

const TONE = {
  Rolling: "accent",
  Queued: "warn",
  Armed: "neutral",
} as const;

export function RollView() {
  const [autoRoll, setAutoRoll] = useState(true);
  const [tick, setTick] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50);
  const [headroomPct, setHeadroomPct] = useState(8);
  const [retries, setRetries] = useState(3);

  // A real countdown, not a static label. The label is correct at frame zero,
  // so it reads properly even if the interval never fires.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lead = ROLL_QUEUE[0];
  const remaining = Math.max(0, lead.nextIn - (tick % (lead.nextIn + 1)));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <>
      <PageHead
        title="Roll Engine"
        lede="Turn short Event Contract windows into long duration structures. On expiry the engine re-strikes into the successor market, keyed by market id rather than pool address, because pools are recycled across windows."
      >
        <button
          type="button"
          role="switch"
          aria-checked={autoRoll}
          onClick={() => setAutoRoll((v) => !v)}
          className={cx(
            "inline-flex items-stretch h-9 border transition-colors",
            autoRoll ? "border-[#0b4d54]" : "border-line",
          )}
        >
          <span className="flex items-center px-3 text-label-xs uppercase text-ink-3 border-r border-inherit">
            Auto roll
          </span>
          <span
            className={cx(
              "flex items-center px-3 text-label-xs uppercase transition-colors",
              autoRoll ? "bg-[#04262a] text-accent" : "text-ink-4",
            )}
          >
            {autoRoll ? "On" : "Off"}
          </span>
        </button>
      </PageHead>

      <DemoData>The roll queue, counters and success rate are sample data. The Roll Engine is not yet executing against live succession chains.</DemoData>

      <div className="grid gap-px bg-line border border-line lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] mb-6">
        {/* succession diagram */}
        <section className="bg-surface flex flex-col min-w-0">
          <header className="flex items-center justify-between h-11 px-4 border-b border-line">
            <span className="text-label-xs uppercase text-ink-3">
              Execution pathway
            </span>
            <span className="num text-label-xs uppercase text-ink-4">{lead.id}</span>
          </header>
          <div className="p-5 flex-1 flex items-center">
            <Succession active={autoRoll} />
          </div>
        </section>

        {/* status */}
        <section className="bg-surface flex flex-col min-w-0">
          <header className="flex items-center justify-between h-11 px-4 border-b border-line">
            <span className="text-label-xs uppercase text-ink-3">Roll status</span>
            <Chip tone={autoRoll ? "accent" : "neutral"} live={autoRoll}>
              {autoRoll ? "Engine ready" : "Paused"}
            </Chip>
          </header>
          <div className="p-4 flex flex-col flex-1">
            <div className="flex items-baseline justify-between gap-4 pb-4 border-b border-line-soft">
              <span className="text-label-xs uppercase text-ink-3">
                Time to next roll
              </span>
              <span className="num text-[26px] leading-[30px] text-accent tabular-nums">
                {mm}
                <span className="text-ink-4 mx-0.5">:</span>
                {ss}
              </span>
            </div>

            <div className="mt-1">
              <KV k="Estimated roll cost" v="0.0245 SOMI" />
              <KV k="Max slippage" v={`${(slippageBps / 100).toFixed(2)}%`} />
              <KV k="Expiry headroom" v={`${headroomPct}% of interval`} />
              <KV k="Retries before abort" v={String(retries)} />
              <KV k="Route" v="Successor market" tone="muted" />
              <KV k="Signer" v="Session key" tone="muted" />
            </div>

            {configOpen ? (
              <div className="mt-4 border border-line p-3 flex flex-col gap-3">
                <NumberField
                  label="Max slippage (bps)"
                  value={slippageBps}
                  min={1}
                  max={500}
                  step={5}
                  onChange={setSlippageBps}
                />
                <NumberField
                  label="Expiry headroom (% of interval)"
                  value={headroomPct}
                  min={1}
                  max={40}
                  step={1}
                  onChange={setHeadroomPct}
                />
                <NumberField
                  label="Retries before abort"
                  value={retries}
                  min={0}
                  max={10}
                  step={1}
                  onChange={setRetries}
                />
              </div>
            ) : null}

            <div className="mt-auto pt-4">
              <Button
                variant="ghost"
                size="md"
                block
                leading={<IconBolt size={15} />}
                onClick={() => setConfigOpen((v) => !v)}
                aria-expanded={configOpen}
              >
                {configOpen ? "Hide parameters" : "Configure parameters"}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <Note icon={<IconInfo size={14} />} tone="accent">
        A window minutes from close can lock between the snapshot and the send,
        so the engine scales its expiry headroom to a fraction of the series
        interval. A fixed 300 second threshold would reject every market on a
        venue running five minute windows.
      </Note>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line my-6">
        <div className="bg-surface p-4">
          <Stat label="Queued rolls" value={String(ROLL_QUEUE.length)} sub="across 2 assets" />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Rolls completed" value="—" sub="no live roll history" mono={false} />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Success rate" value="—" sub="engine not yet executing" mono={false} />
        </div>
        <div className="bg-surface p-4">
          <Stat label="Median roll cost" value="—" sub="no completed rolls" mono={false} />
        </div>
      </div>

      <div className="border border-line bg-surface">
        <header className="flex items-center justify-between h-11 px-4 border-b border-line">
          <span className="text-label-xs uppercase text-ink-3">Active roll queue</span>
          <span className="text-label-xs uppercase text-ink-4">
            keyed by market id
          </span>
        </header>

        <TableWrap>
          <thead>
            <tr>
              <Th>Job</Th>
              <Th>Market</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th align="right">Size</Th>
              <Th align="left">Progress</Th>
              <Th align="right">Next in</Th>
              <Th align="center">Status</Th>
            </tr>
          </thead>
          <tbody>
            {ROLL_QUEUE.map((j) => (
              <Tr key={j.id}>
                <Td mono tone="muted">
                  {j.id}
                </Td>
                <Td mono>{j.asset}</Td>
                <Td tone="muted">{j.from}</Td>
                <Td>
                  <span className="inline-flex items-center gap-2 text-ink">
                    <IconRoll size={13} className="text-accent" />
                    {j.to}
                  </span>
                </Td>
                <Td align="right" mono>
                  {j.size}
                </Td>
                <Td className="w-[180px]">
                  <span className="flex items-center gap-2.5">
                    <span className="relative block h-[6px] flex-1 bg-line-soft">
                      <span
                        className="absolute inset-y-0 left-0 bg-accent"
                        style={{ width: `${Math.max(j.progress * 100, 2)}%` }}
                      />
                    </span>
                    <span className="num text-[11px] text-ink-3 w-[34px] text-right">
                      {Math.round(j.progress * 100)}%
                    </span>
                  </span>
                </Td>
                <Td align="right" mono tone="muted">
                  {String(Math.floor(j.nextIn / 60)).padStart(2, "0")}:
                  {String(j.nextIn % 60).padStart(2, "0")}
                </Td>
                <Td align="center">
                  <Chip tone={TONE[j.status]} live={j.status === "Rolling"}>
                    {j.status}
                  </Chip>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-ink-3 min-w-0">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) =>
          onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))
        }
        className="num w-[76px] shrink-0 h-8 bg-base border border-line px-2 text-[12px] text-ink outline-none focus:border-accent transition-colors"
      />
    </label>
  );
}

/**
 * The succession diagram: four expiring windows chaining into one tenor.
 * Fully drawn at rest; the travelling pulse is the only animated part.
 */
function Succession({ active }: { active: boolean }) {
  const W = 620;
  const H = 168;
  const windows = [
    { label: "W-3", state: "done" },
    { label: "W-2", state: "done" },
    { label: "W-1", state: "live" },
    { label: "W", state: "next" },
  ] as const;

  const boxW = 96;
  const gap = 44;
  const startX = 26;
  const y = 30;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      role="img"
      aria-label="Four consecutive Event Contract windows chained by the roll engine into a single longer tenor."
    >
      {/* chain */}
      {windows.map((w, i) => {
        const x = startX + i * (boxW + gap);
        const done = w.state === "done";
        const live = w.state === "live";
        return (
          <g key={w.label}>
            <rect
              x={x}
              y={y}
              width={boxW}
              height={52}
              fill={live ? "#04262a" : "#0d0e0f"}
              stroke={live ? "#00f0ff" : done ? "#2a3234" : "#222222"}
              strokeWidth="1"
            />
            <text
              x={x + boxW / 2}
              y={y + 22}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={live ? "#00f0ff" : done ? "#888888" : "#5a5f60"}
              fontSize="12"
              fontWeight="600"
              fontFamily="var(--font-jetbrains), monospace"
            >
              {w.label}
            </text>
            <text
              x={x + boxW / 2}
              y={y + 38}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#5a5f60"
              fontSize="9"
              letterSpacing="0.09em"
              fontFamily="var(--font-inter), sans-serif"
            >
              {done ? "ROLLED" : live ? "TRADING" : "SUCCESSOR"}
            </text>

            {i < windows.length - 1 ? (
              <g>
                <line
                  x1={x + boxW}
                  y1={y + 26}
                  x2={x + boxW + gap}
                  y2={y + 26}
                  stroke={done ? "#2a3234" : "#123c41"}
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <path
                  d={`M${x + boxW + gap - 7} ${y + 22}l5 4-5 4`}
                  stroke={done ? "#3a4143" : "#00f0ff"}
                  strokeWidth="1.25"
                  fill="none"
                  strokeLinejoin="miter"
                />
              </g>
            ) : null}
          </g>
        );
      })}

      {/* the carried position, spanning the whole chain */}
      <line
        x1={startX}
        y1={116}
        x2={startX + windows.length * (boxW + gap) - gap}
        y2={116}
        stroke="#00f0ff"
        strokeWidth="1.25"
      />
      {windows.map((_, i) => {
        const x = startX + i * (boxW + gap) + boxW / 2;
        return <rect key={i} x={x - 2.5} y={113.5} width="5" height="5" fill="#00f0ff" />;
      })}
      {active ? (
        <rect
          x={startX - 4}
          y={112}
          width="8"
          height="8"
          fill="#7df4ff"
          style={
            {
              ["--carry" as string]: `${windows.length * (boxW + gap) - gap}px`,
              animation: "prism-carry 3.8s cubic-bezier(.55,0,.45,1) infinite",
            } as React.CSSProperties
          }
        />
      ) : null}

      <text
        x={startX}
        y={106}
        fill="#6f7677"
        fontSize="9.5"
        fontWeight="600"
        letterSpacing="0.09em"
        fontFamily="var(--font-inter), sans-serif"
      >
        CARRIED POSITION
      </text>
      <text
        x={startX}
        y={142}
        fill="#5a5f60"
        fontSize="10"
        fontFamily="var(--font-inter), sans-serif"
      >
        Four 5m windows held as one 20m tenor. Legs re-struck each succession.
      </text>
    </svg>
  );
}
