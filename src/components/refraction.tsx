/**
 * THE SIGNATURE ARTIFACT — Refraction.
 *
 * One incoming ray (the trader's view) strikes the prism and leaves as a
 * spectrum of legs. It is not decoration: it is literally what the router does,
 * so the hero visual and the product mechanism are the same object.
 *
 * The geometry is real. The beam terminates exactly on the prism's left face,
 * bends through the body, and every outgoing leg departs from the single exit
 * point on the right face — the entry, the internal path and the exit are
 * solved against the triangle rather than eyeballed.
 *
 * Motion rule held strictly: every ray's resting state is FULLY DRAWN
 * (stroke-dashoffset 0). The trace animation runs *from* an offset toward that
 * resting state, so if the animation never fires — reduced motion, a
 * backgrounded tab, a screenshot pass — the diagram still renders complete.
 */

export interface RefractionLeg {
  label: string;
  detail: string;
}

const COLORS = ["#7df4ff", "#00b4ff", "#0072ff"];

const DEFAULT_LEGS: RefractionLeg[] = [
  { label: "LONG UP", detail: "lower strike" },
  { label: "SHORT UP", detail: "upper strike" },
  { label: "ROLL", detail: "next window" },
];

export function Refraction({
  legs = DEFAULT_LEGS,
  compact = false,
  className,
}: {
  legs?: RefractionLeg[];
  compact?: boolean;
  className?: string;
}) {
  const W = 640;
  const H = 152;

  // Prism triangle
  const apexX = 258;
  const apexY = 18;
  const baseY = 130;
  const half = 60;
  const height = baseY - apexY;

  /** x of the left face at a given y. */
  const leftFaceX = (y: number) => apexX - (half * (y - apexY)) / height;
  /** x of the right face at a given y. */
  const rightFaceX = (y: number) => apexX + (half * (y - apexY)) / height;

  const entryY = 66;
  const entryX = leftFaceX(entryY);
  const exitY = 100;
  const exitX = rightFaceX(exitY);

  const endX = 452;
  const rows = legs.slice(0, 3);
  const spread = rows.length > 1 ? 44 : 0;
  const firstY = exitY - ((rows.length - 1) * spread) / 2 - 18;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        role="img"
        aria-label={`A market view entering the PRISM router and leaving as ${rows.length} Event Contract legs: ${rows
          .map((l) => `${l.label} ${l.detail}`)
          .join(", ")}.`}
      >
        <defs>
          <linearGradient id="rf-in" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.95" />
          </linearGradient>
          {rows.map((_, i) => (
            <linearGradient key={i} id={`rf-out-${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={COLORS[i % COLORS.length]} stopOpacity="0.95" />
              <stop offset="1" stopColor={COLORS[i % COLORS.length]} stopOpacity="0.3" />
            </linearGradient>
          ))}
        </defs>

        {/* incoming view ray, terminating exactly on the left face */}
        <line
          x1="10"
          y1={entryY}
          x2={entryX}
          y2={entryY}
          stroke="url(#rf-in)"
          strokeWidth="1.5"
        />
        <rect x={entryX - 2.5} y={entryY - 2.5} width="5" height="5" fill="#ffffff" />

        {/* prism body — the bespoke silhouette */}
        <path
          d={`M${apexX} ${apexY} L${apexX + half} ${baseY} L${apexX - half} ${baseY} Z`}
          fill="#0a1416"
          stroke="#1d494e"
          strokeWidth="1"
          strokeLinejoin="miter"
        />
        <path
          d={`M${apexX} ${apexY} L${apexX} ${baseY} M${apexX - half} ${baseY} L${apexX + half * 0.34} ${apexY + height * 0.4} M${apexX + half} ${baseY} L${apexX - half * 0.34} ${apexY + height * 0.4}`}
          stroke="#12363a"
          strokeWidth="0.75"
        />

        {/* the internal, bent path from entry to exit */}
        <line
          x1={entryX}
          y1={entryY}
          x2={exitX}
          y2={exitY}
          stroke="#bfefff"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          style={{ animation: "prism-dash 1.6s linear infinite" }}
        />
        <rect x={exitX - 2.5} y={exitY - 2.5} width="5" height="5" fill="#7df4ff" />

        {/* outgoing legs, all departing from the single exit point */}
        {rows.map((leg, i) => {
          const y = firstY + i * spread;
          const len = Math.hypot(endX - exitX, y - exitY) + 6;
          return (
            <g key={`${leg.label}-${i}`}>
              <path
                d={`M${exitX} ${exitY} L${endX} ${y}`}
                stroke={`url(#rf-out-${i})`}
                strokeWidth="1.5"
                fill="none"
                strokeDasharray={len}
                strokeDashoffset={0}
                style={
                  {
                    ["--len" as string]: `${len}`,
                    animation: `prism-trace 2.8s cubic-bezier(.2,.7,.2,1) ${i * 0.14}s infinite`,
                  } as React.CSSProperties
                }
              />
              <rect
                x={endX - 3}
                y={y - 3}
                width="6"
                height="6"
                fill={COLORS[i % COLORS.length]}
              />
              <text
                x={endX + 14}
                y={y}
                dominantBaseline="middle"
                fill="#e6f8fa"
                fontSize="10.5"
                fontWeight="600"
                letterSpacing="0.08em"
                fontFamily="var(--font-inter), sans-serif"
              >
                {leg.label}
              </text>
              {!compact && (
                <text
                  x={endX + 14}
                  y={y + 13}
                  dominantBaseline="middle"
                  fill="#6f7677"
                  fontSize="9.5"
                  letterSpacing="0.02em"
                  fontFamily="var(--font-jetbrains), monospace"
                >
                  {leg.detail}
                </text>
              )}
            </g>
          );
        })}

        {/* labels, clear of every edge */}
        <text
          x="10"
          y={entryY - 13}
          fill="#6f7677"
          fontSize="9.5"
          fontWeight="600"
          letterSpacing="0.1em"
          fontFamily="var(--font-inter), sans-serif"
        >
          MARKET VIEW
        </text>
        <text
          x={apexX}
          y={baseY + 14}
          fill="#3f8f97"
          fontSize="9.5"
          fontWeight="600"
          letterSpacing="0.14em"
          textAnchor="middle"
          fontFamily="var(--font-inter), sans-serif"
        >
          PRISM ROUTER
        </text>
      </svg>
    </div>
  );
}
