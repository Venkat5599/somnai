/**
 * PRISM marks.
 *
 * Redrawn from the supplied logo as vector so it stays crisp at 20px in the
 * sidebar and at 200px in the hero. The facet structure and the ascending
 * arrow crossing the triangle are preserved; the raster bloom is not, because
 * a soft halo behind a mark is exactly the tell the brief warns against.
 */

interface MarkProps {
  size?: number;
  className?: string;
}

export function PrismMark({ size = 28, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="pm-facet" x1="14" y1="56" x2="52" y2="8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0072ff" />
          <stop offset="0.55" stopColor="#00b4ff" />
          <stop offset="1" stopColor="#7fa3ff" />
        </linearGradient>
      </defs>

      {/* outer triangle */}
      <path
        d="M32 6 58 56H6L32 6Z"
        stroke="url(#pm-facet)"
        strokeWidth="2"
        strokeLinejoin="miter"
      />
      {/* internal facets */}
      <g stroke="url(#pm-facet)" strokeWidth="1.1" opacity="0.75">
        <path d="M32 6v50" />
        <path d="M32 6 17 42h30L32 6Z" />
        <path d="M6 56 17 42M58 56 47 42" />
        <path d="M17 42h30" />
      </g>
      {/* the ascending ray crossing the prism */}
      <path
        d="M14 47l10-11 7 7 12-16"
        stroke="#e8efff"
        strokeWidth="2.6"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <path d="M35.5 27H43v7.5" stroke="#e8efff" strokeWidth="2.6" strokeLinejoin="miter" />
    </svg>
  );
}

/**
 * The wordmark. Set in the display face at a deliberate tight tracking so the
 * five caps read as one machined block, matching the supplied logotype.
 */
export function PrismWordmark({
  className,
  size = 20,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={className}
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: "-0.035em",
        lineHeight: 1,
        display: "inline-block",
      }}
    >
      PRISM
    </span>
  );
}

export function PrismLockup({
  markSize = 26,
  wordSize = 19,
  tagline = false,
}: {
  markSize?: number;
  wordSize?: number;
  tagline?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <PrismMark size={markSize} />
      <span className="flex flex-col justify-center">
        <PrismWordmark size={wordSize} className="text-accent" />
        {tagline && (
          <span className="text-label-xs uppercase text-ink-4 mt-1">
            Structured derivatives terminal
          </span>
        )}
      </span>
    </span>
  );
}
