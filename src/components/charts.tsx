"use client";

/**
 * PRISM charts.
 *
 * Hand-built SVG rather than a charting library: at this density a library
 * fights the grid more than it helps, and every stroke here has to sit on the
 * 1px structural language. Single-pixel accent strokes, dashed #222 grid,
 * 10-to-0 percent gradient fills, tabular numerals on every axis.
 *
 * All series render at full opacity immediately. No entrance reveal anywhere.
 */

import { useId, useMemo, useState } from "react";
import { fmtK, fmtSigned, type DensityPoint } from "@/lib/quant";
import { cx } from "./ui";

/* ------------------------------------------------------------------ */
/* Payoff                                                              */
/* ------------------------------------------------------------------ */

export interface PayoffChartProps {
  curve: { s: number; pnl: number }[];
  breakevens: number[];
  spot: number;
  height?: number;
  /** Optional band to shade as the target zone. */
  band?: [number, number];
}

export function PayoffChart({
  curve,
  breakevens,
  spot,
  height = 300,
  band,
}: PayoffChartProps) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  // Left and right padding must clear half the widest axis label, or the
  // outermost tick text gets shaved by the viewBox edge.
  const PAD = { t: 22, r: 34, b: 32, l: 34 };
  const W = 720;
  const H = height;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const geom = useMemo(() => {
    if (!curve.length) return null;
    const xs = curve.map((p) => p.s);
    const ys = curve.map((p) => p.pnl);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const yMin = Math.min(...ys, 0);
    const yMax = Math.max(...ys, 0);
    const padY = (yMax - yMin) * 0.16 || 1;
    const lo = yMin - padY;
    const hi = yMax + padY;
    const X = (s: number) => PAD.l + ((s - x0) / (x1 - x0 || 1)) * iw;
    const Y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * ih;
    return { x0, x1, lo, hi, X, Y };
  }, [curve, ih, iw, PAD.l, PAD.t]);

  if (!geom) return null;
  const { x0, x1, X, Y } = geom;

  const line = curve.map((p, i) => `${i ? "L" : "M"}${X(p.s).toFixed(2)} ${Y(p.pnl).toFixed(2)}`).join("");
  const zeroY = Y(0);

  // Split the area fill at the zero line so profit reads green-free but
  // distinct from loss, using opacity rather than a second hue.
  const areaUp =
    curve
      .map((p) => `${X(p.s).toFixed(2)} ${Y(Math.max(p.pnl, 0)).toFixed(2)}`)
      .map((c, i) => `${i ? "L" : "M"}${c}`)
      .join("") + `L${X(x1).toFixed(2)} ${zeroY.toFixed(2)}L${X(x0).toFixed(2)} ${zeroY.toFixed(2)}Z`;

  const ticks = 5;
  const xTicks = Array.from({ length: ticks }, (_, i) => x0 + ((x1 - x0) * i) / (ticks - 1));

  const hoverPoint =
    hover === null
      ? null
      : curve.reduce((best, p) => (Math.abs(p.s - hover) < Math.abs(best.s - hover) ? p : best));

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block select-none"
        role="img"
        aria-label={`Structure payoff from ${fmtK(x0)} to ${fmtK(x1)}. Breakeven at ${breakevens.map((b) => fmtK(b)).join(" and ") || "none"}.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const s = x0 + ((px - PAD.l) / iw) * (x1 - x0);
          setHover(Math.min(Math.max(s, x0), x1));
        }}
      >
        <defs>
          <linearGradient id={`pf-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#00f0ff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#00f0ff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`clip-${uid}`}>
            <rect x={PAD.l} y={PAD.t} width={iw} height={ih} />
          </clipPath>
        </defs>

        {/* grid */}
        <g stroke="#222222" strokeWidth="1" strokeDasharray="2 4">
          {Array.from({ length: 5 }, (_, i) => {
            const y = PAD.t + (ih * i) / 4;
            return <line key={i} x1={PAD.l} y1={y} x2={PAD.l + iw} y2={y} />;
          })}
          {xTicks.map((t, i) => (
            <line key={i} x1={X(t)} y1={PAD.t} x2={X(t)} y2={PAD.t + ih} />
          ))}
        </g>

        {/* target band */}
        {band ? (
          <rect
            x={X(band[0])}
            y={PAD.t}
            width={Math.max(0, X(band[1]) - X(band[0]))}
            height={ih}
            fill="#00f0ff"
            fillOpacity="0.045"
          />
        ) : null}

        <g clipPath={`url(#clip-${uid})`}>
          <path d={areaUp} fill={`url(#pf-${uid})`} />
          <path d={line} fill="none" stroke="#00f0ff" strokeWidth="1.25" strokeLinejoin="miter" />
        </g>

        {/* zero line */}
        <line
          x1={PAD.l}
          y1={zeroY}
          x2={PAD.l + iw}
          y2={zeroY}
          stroke="#3a4143"
          strokeWidth="1"
        />

        {/* spot marker */}
        {spot >= x0 && spot <= x1 ? (
          <g>
            <line
              x1={X(spot)}
              y1={PAD.t}
              x2={X(spot)}
              y2={PAD.t + ih}
              stroke="#5a6062"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={X(spot)}
              y={PAD.t - 6}
              fill="#888888"
              fontSize="9.5"
              fontWeight="600"
              letterSpacing="0.08em"
              textAnchor="middle"
            >
              SPOT
            </text>
          </g>
        ) : null}

        {/* breakevens */}
        {breakevens.map((b, i) => (
          <g key={i}>
            <line
              x1={X(b)}
              y1={PAD.t}
              x2={X(b)}
              y2={PAD.t + ih}
              stroke="#00f0ff"
              strokeWidth="1"
              strokeOpacity="0.35"
            />
            <rect x={X(b) - 2} y={zeroY - 2} width="4" height="4" fill="#00f0ff" />
          </g>
        ))}

        {/* hover readout */}
        {hoverPoint ? (
          <g>
            <line
              x1={X(hoverPoint.s)}
              y1={PAD.t}
              x2={X(hoverPoint.s)}
              y2={PAD.t + ih}
              stroke="#00f0ff"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <rect
              x={X(hoverPoint.s) - 3}
              y={Y(hoverPoint.pnl) - 3}
              width="6"
              height="6"
              fill="#050505"
              stroke="#00f0ff"
              strokeWidth="1.25"
            />
          </g>
        ) : null}

        {/* x axis */}
        <g fill="#888888" fontSize="10" textAnchor="middle" fontFamily="var(--font-geist-mono), ui-monospace, monospace">
          {xTicks.map((t, i) => (
            <text key={i} x={X(t)} y={H - 10}>
              {fmtK(Math.round(t))}
            </text>
          ))}
        </g>
      </svg>

      {/* Readout lives outside the SVG so it can never be clipped by the plot. */}
      <div className="flex items-center justify-between gap-4 mt-2 h-5">
        <span className="text-[11px] text-ink-3">
          {breakevens.length ? (
            <>
              Breakeven{" "}
              <span className="num text-ink-2">
                {breakevens.map((b) => fmtK(Math.round(b))).join(" / ")}
              </span>
            </>
          ) : (
            <span className="text-ink-4">No breakeven in range</span>
          )}
        </span>
        {hoverPoint ? (
          <span className="text-[11px] text-ink-3">
            <span className="num text-ink-2">{fmtK(Math.round(hoverPoint.s))}</span>
            <span className="mx-2 text-ink-4">/</span>
            <span className={cx("num", hoverPoint.pnl >= 0 ? "text-up" : "text-down")}>
              {fmtSigned(hoverPoint.pnl)}
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-4">Hover the curve for settlement P&amp;L</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Risk-neutral density                                                */
/* ------------------------------------------------------------------ */

export function DensityChart({
  points,
  spot,
  height = 190,
}: {
  points: DensityPoint[];
  spot: number;
  height?: number;
}) {
  const uid = useId().replace(/:/g, "");
  if (points.length < 2) return null;

  const PAD = { t: 12, r: 30, b: 28, l: 30 };
  const W = 560;
  const H = height;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const x0 = points[0].strike;
  const x1 = points[points.length - 1].strike;
  const dMax = Math.max(...points.map((p) => p.density)) || 1;

  const X = (s: number) => PAD.l + ((s - x0) / (x1 - x0)) * iw;
  const Y = (d: number) => PAD.t + (1 - d / (dMax * 1.12)) * ih;

  // Catmull-Rom to Bezier so the density reads as a curve, not a polyline.
  const path = points
    .map((p, i, a) => {
      if (i === 0) return `M${X(p.strike).toFixed(2)} ${Y(p.density).toFixed(2)}`;
      const p0 = a[i - 2] ?? a[i - 1];
      const p1 = a[i - 1];
      const p2 = p;
      const p3 = a[i + 1] ?? p;
      const c1x = X(p1.strike) + (X(p2.strike) - X(p0.strike)) / 6;
      const c1y = Y(p1.density) + (Y(p2.density) - Y(p0.density)) / 6;
      const c2x = X(p2.strike) - (X(p3.strike) - X(p1.strike)) / 6;
      const c2y = Y(p2.density) - (Y(p3.density) - Y(p1.density)) / 6;
      return `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${X(p2.strike).toFixed(2)} ${Y(p2.density).toFixed(2)}`;
    })
    .join("");

  const area = `${path}L${X(x1).toFixed(2)} ${PAD.t + ih}L${X(x0).toFixed(2)} ${PAD.t + ih}Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      role="img"
      aria-label="Risk-neutral probability density recovered from the Event Contract strike ladder."
    >
      <defs>
        <linearGradient id={`dn-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00f0ff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#00f0ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g stroke="#222222" strokeWidth="1" strokeDasharray="2 4">
        {Array.from({ length: 4 }, (_, i) => {
          const y = PAD.t + (ih * i) / 3;
          return <line key={i} x1={PAD.l} y1={y} x2={PAD.l + iw} y2={y} />;
        })}
      </g>

      <path d={area} fill={`url(#dn-${uid})`} />
      <path d={path} fill="none" stroke="#00f0ff" strokeWidth="1.25" />

      {points.map((p) => (
        <line
          key={p.strike}
          x1={X(p.strike)}
          y1={PAD.t + ih}
          x2={X(p.strike)}
          y2={PAD.t + ih - 4}
          stroke="#3a4143"
          strokeWidth="1"
        />
      ))}

      {spot >= x0 && spot <= x1 ? (
        <line
          x1={X(spot)}
          y1={PAD.t}
          x2={X(spot)}
          y2={PAD.t + ih}
          stroke="#888888"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ) : null}

      <g
        fill="#888888"
        fontSize="9.5"
        textAnchor="middle"
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const s = x0 + (x1 - x0) * f;
          return (
            <text key={i} x={X(s)} y={H - 9}>
              {fmtK(Math.round(s))}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Implied vol surface — an isometric wire mesh                        */
/* ------------------------------------------------------------------ */

export function IVSurface({
  grid,
  columns,
  rows: rowLabels,
  columnAxisLabel = "STRIKE",
  rowAxisLabel = "EXPIRY",
  height = 300,
}: {
  /** grid[rowIndex][columnIndex] = implied vol */
  grid: number[][];
  columns: string[];
  rows: string[];
  columnAxisLabel?: string;
  rowAxisLabel?: string;
  height?: number;
}) {
  const W = 680;
  const H = height;

  const rows = grid.length;
  const cols = columns.length;
  const all = grid.flat().filter((v) => Number.isFinite(v));
  if (!rows || !cols || !all.length) return null;
  const vMin = Math.min(...all);
  const vMax = Math.max(...all);

  // Isometric projection. Column axis runs right, row axis runs right-and-up.
  const ox = 128;
  const oy = H - 68;
  const cellX = (W - 268) / Math.max(cols - 1, 1);
  const rowX = 54 / Math.max(rows - 1, 1);
  const rowY = 116 / Math.max(rows - 1, 1);
  const lift = 118;

  const project = (r: number, c: number, v: number) => {
    const x = ox + c * cellX + r * rowX;
    const depth = oy - r * rowY;
    const h = ((v - vMin) / (vMax - vMin || 1)) * lift;
    return [x, depth - h] as const;
  };

  const shade = (v: number) => {
    const t = (v - vMin) / (vMax - vMin || 1);
    // A single-hue tonal ramp off the accent. No second colour, no rainbow.
    return `hsl(186 100% ${26 + t * 44}%)`;
  };

  const quads: { d: string; fill: string }[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = project(r, c, grid[r][c]);
      const b = project(r, c + 1, grid[r][c + 1]);
      const d = project(r + 1, c + 1, grid[r + 1][c + 1]);
      const e = project(r + 1, c, grid[r + 1][c]);
      const v =
        (grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1]) / 4;
      quads.push({
        d: `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${d[0].toFixed(1)} ${d[1].toFixed(1)}L${e[0].toFixed(1)} ${e[1].toFixed(1)}Z`,
        fill: shade(v),
      });
    }
  }
  // Painter's order: far rows first.
  quads.reverse();

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      role="img"
      aria-label="Implied volatility surface across standardised moneyness and expiry, derived from Event Contract prices."
    >
      {quads.map((q, i) => (
        <path
          key={i}
          d={q.d}
          fill={q.fill}
          fillOpacity="0.20"
          stroke={q.fill}
          strokeWidth="0.8"
          strokeOpacity="0.75"
        />
      ))}

      {/* axes */}
      <g stroke="#3a4143" strokeWidth="1">
        <line x1={ox - 12} y1={oy + 10} x2={ox + (cols - 1) * cellX + 12} y2={oy + 10} />
        <line
          x1={ox - 12}
          y1={oy + 10}
          x2={ox - 12 + (rows - 1) * rowX}
          y2={oy + 10 - (rows - 1) * rowY}
        />
      </g>

      <g fill="#888888" fontSize="9.5" fontFamily="var(--font-geist-mono), ui-monospace, monospace">
        {columns.map((label, c) =>
          c % 2 === 0 ? (
            <text key={c} x={ox + c * cellX} y={oy + 26} textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}
        {rowLabels.map((label, r) => (
          <text
            key={label}
            x={ox - 22 + r * rowX}
            y={oy + 14 - r * rowY}
            textAnchor="end"
          >
            {label}
          </text>
        ))}
      </g>

      <g
        fill="#5a5f60"
        fontSize="9"
        fontWeight="600"
        letterSpacing="0.1em"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        <text x={ox + ((cols - 1) * cellX) / 2} y={H - 8} textAnchor="middle">
          {columnAxisLabel}
        </text>
        <text x={16} y={oy - (rows - 1) * rowY - 16}>
          {rowAxisLabel}
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Depth bar — book volume behind a number                             */
/* ------------------------------------------------------------------ */

export function DepthBar({
  value,
  max,
  side,
}: {
  value: number;
  max: number;
  side: "up" | "down";
}) {
  const pct = Math.min(100, (value / (max || 1)) * 100);
  return (
    <span className="relative inline-flex items-center justify-end w-full h-5 px-1.5">
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-0 right-0",
          side === "up" ? "bg-up/10" : "bg-down/10",
        )}
        style={{ width: `${pct}%` }}
      />
      <span className="relative num text-[12px]">{value.toLocaleString("en-US")}</span>
    </span>
  );
}
