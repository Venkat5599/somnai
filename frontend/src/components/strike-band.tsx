"use client";

/**
 * StrikeBand — the band selector, drawn on the actual strike ladder.
 *
 * Not a generic range slider. The rail is the ladder: one tick per live Event
 * Contract, taller where the resting depth is deeper, so choosing a band and
 * reading liquidity are the same gesture. Handles are chamfered brackets that
 * grip the rail rather than knobs sitting on it.
 *
 * Fully keyboard operable: each handle is a real slider role with arrow, page,
 * home and end keys, and every value is announced.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./ui";
import { fmtK } from "@sdk/quant";

export interface StrikeBandProps {
  strikes: number[];
  depth: Record<number, number>;
  lower: number;
  upper: number;
  single?: boolean;
  spot: number;
  onChange: (lower: number, upper: number) => void;
}

export function StrikeBand({
  strikes,
  depth,
  lower,
  upper,
  single,
  spot,
  onChange,
}: StrikeBandProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"lo" | "hi" | null>(null);

  const min = strikes[0];
  const max = strikes[strikes.length - 1];
  const span = max - min || 1;
  const pct = (v: number) => ((v - min) / span) * 100;
  const maxDepth = Math.max(...strikes.map((s) => depth[s] ?? 0), 1);

  const snap = useCallback(
    (raw: number) =>
      strikes.reduce((best, s) =>
        Math.abs(s - raw) < Math.abs(best - raw) ? s : best,
      ),
    [strikes],
  );

  const fromClientX = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (!rail) return min;
      const r = rail.getBoundingClientRect();
      const t = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
      return snap(min + t * span);
    },
    [min, snap, span],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const v = fromClientX(e.clientX);
      if (single) {
        onChange(v, v);
        return;
      }
      if (dragging === "lo") onChange(Math.min(v, upper), upper);
      else onChange(lower, Math.max(v, lower));
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, fromClientX, lower, upper, onChange, single]);

  const step = (which: "lo" | "hi", dir: number, big = false) => {
    const cur = which === "lo" ? lower : upper;
    const i = strikes.indexOf(snap(cur));
    const next = strikes[Math.min(Math.max(i + dir * (big ? 3 : 1), 0), strikes.length - 1)];
    if (single) return onChange(next, next);
    if (which === "lo") onChange(Math.min(next, upper), upper);
    else onChange(lower, Math.max(next, lower));
  };

  const onKey = (which: "lo" | "hi") => (e: React.KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => step(which, -1),
      ArrowDown: () => step(which, -1),
      ArrowRight: () => step(which, 1),
      ArrowUp: () => step(which, 1),
      PageDown: () => step(which, -1, true),
      PageUp: () => step(which, 1, true),
      Home: () => (which === "lo" ? onChange(min, upper) : onChange(lower, min)),
      End: () => (which === "lo" ? onChange(max, upper) : onChange(lower, max)),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className="w-full select-none">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-label-xs uppercase text-ink-3">
          {single ? "Strike" : "Target range"}
        </span>
        <span className="num text-[13px] text-accent">
          {single
            ? fmtK(lower)
            : `${lower.toLocaleString("en-US")}–${upper.toLocaleString("en-US")}`}
        </span>
      </div>

      {/* rail: 44px tall so the handles never clip against the edges */}
      <div
        ref={railRef}
        className="relative h-[44px] cursor-pointer"
        onPointerDown={(e) => {
          const v = fromClientX(e.clientX);
          if (single) {
            onChange(v, v);
            setDragging("lo");
            return;
          }
          const nearLo = Math.abs(v - lower) <= Math.abs(v - upper);
          if (nearLo) onChange(Math.min(v, upper), upper);
          else onChange(lower, Math.max(v, lower));
          setDragging(nearLo ? "lo" : "hi");
        }}
      >
        {/* depth ticks — the ladder itself */}
        <div className="absolute inset-x-0 bottom-[14px] h-[22px]">
          {strikes.map((s) => {
            const d = (depth[s] ?? 0) / maxDepth;
            const inBand = single ? s === lower : s >= lower && s <= upper;
            return (
              <span
                key={s}
                aria-hidden
                className={cx(
                  "absolute bottom-0 w-px transition-colors duration-150",
                  inBand ? "bg-accent" : "bg-line-strong",
                )}
                style={{
                  left: `${pct(s)}%`,
                  height: `${6 + d * 16}px`,
                  opacity: inBand ? 0.9 : 0.55,
                }}
              />
            );
          })}
        </div>

        {/* base rail */}
        <div className="absolute inset-x-0 bottom-[13px] h-px bg-line-strong" />

        {/* selected span */}
        {!single ? (
          <div
            className="absolute bottom-[13px] h-px bg-accent"
            style={{ left: `${pct(lower)}%`, width: `${pct(upper) - pct(lower)}%` }}
          />
        ) : null}

        {/* spot marker */}
        {spot >= min && spot <= max ? (
          <div
            aria-hidden
            className="absolute bottom-[8px] flex flex-col items-center -translate-x-1/2"
            style={{ left: `${pct(spot)}%` }}
          >
            <span className="w-px h-[11px] bg-ink-3" />
          </div>
        ) : null}

        {/* handles */}
        <Handle
          pos={pct(lower)}
          value={lower}
          min={min}
          max={single ? max : upper}
          label={single ? "Strike" : "Lower strike"}
          active={dragging === "lo"}
          onKeyDown={onKey("lo")}
          onPointerDown={() => setDragging("lo")}
        />
        {!single ? (
          <Handle
            pos={pct(upper)}
            value={upper}
            min={lower}
            max={max}
            label="Upper strike"
            active={dragging === "hi"}
            flip
            onKeyDown={onKey("hi")}
            onPointerDown={() => setDragging("hi")}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between mt-1 num text-[11px] text-ink-4">
        <span>{fmtK(min)}</span>
        <span>{fmtK(max)}</span>
      </div>
    </div>
  );
}

function Handle({
  pos,
  value,
  min,
  max,
  label,
  active,
  flip,
  onKeyDown,
  onPointerDown,
}: {
  pos: number;
  value: number;
  min: number;
  max: number;
  label: string;
  active: boolean;
  flip?: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPointerDown: () => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={value.toLocaleString("en-US")}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown();
      }}
      className="absolute bottom-[6px] -translate-x-1/2 cursor-ew-resize touch-none"
      style={{ left: `${pos}%` }}
    >
      {/* Chamfered bracket: a specific silhouette, not a round knob. */}
      <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden>
        <path
          d={flip ? "M13 1H4L1 4v10l3 3h9" : "M1 1h9l3 3v10l-3 3H1"}
          fill={active ? "#e0a33f" : "#0c0b0a"}
          stroke="#e0a33f"
          strokeWidth="1.25"
          strokeLinejoin="miter"
        />
      </svg>
    </div>
  );
}
