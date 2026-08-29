"use client";

/**
 * The claim strip.
 *
 * The reference runs a scrolling band of adjectives — COMMUNITY-DRIVEN, SECURE,
 * GREEN, FAST. Adjectives are free, so they carry no information: every project
 * would put the same six words there.
 *
 * PRISM's band carries CONSTRAINTS instead. Each item is a checkable statement
 * about how execution works here, and every one of them is enforced somewhere in
 * `sdk/` — a reader who doubts one can go find it. That is the only version of
 * this strip worth shipping.
 *
 * Motion runs on the CSS animation, duplicated once so the loop is seamless. The
 * content is in the DOM either way, so a browser that never animates it shows a
 * static row of the same claims rather than an empty band.
 */

const CLAIMS = [
  "OUTCOMES RE-DERIVED FROM CHAIN",
  "INTEGER TICK AND LOT GRID",
  "SINGLE-WRITER NONCE",
  "IOC BY DEFAULT",
  "MANDATORY ORDER EXPIRY",
  "NO SIMULATED DATA",
  "UNKNOWN IS NEVER SUCCESS",
];

export function ClaimMarquee() {
  return (
    <div className="relative overflow-hidden py-3"
      style={{
        background: "var(--pg-card, var(--color-surface))",
        borderTop: "1px solid var(--pg-line, var(--color-line))",
        borderBottom: "1px solid var(--pg-line, var(--color-line))",
      }}>
      {/* Edges fade so the band reads as continuing past the viewport rather
          than starting and stopping at two hard vertical lines. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28 z-10"
        style={{ background: "linear-gradient(to right, var(--pg-card, var(--color-base)), transparent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28 z-10"
        style={{ background: "linear-gradient(to left, var(--pg-card, var(--color-base)), transparent)" }}
      />

      <div className="flex w-max animate-[prism-marquee_38s_linear_infinite] motion-reduce:animate-none">
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1} className="flex items-center shrink-0">
            {CLAIMS.map((c) => (
              <li key={c} className="flex items-center shrink-0">
                <span className="num text-label-xs uppercase tracking-[0.07em] px-5 sm:px-7"
                  style={{ color: "var(--pg-ink-3, var(--color-ink-3))" }}>
                  {c}
                </span>
                {/* A rounded cap, not a bare hairline: an unrounded rule used as
                    ornament is the cheap version of a separator. */}
                <span aria-hidden className="w-4 h-px rounded-full shrink-0"
                  style={{ background: "var(--pg-line, var(--color-line-strong))" }} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
