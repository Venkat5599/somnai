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

import { HeroFieldGL } from "./hero-field-gl";

const CLAIMS = [
  "OUTCOMES RE-DERIVED FROM CHAIN",
  "INTEGER TICK AND LOT GRID",
  "SINGLE-WRITER NONCE",
  "IOC BY DEFAULT",
  "MANDATORY ORDER EXPIRY",
  "NO SIMULATED DATA",
  "UNKNOWN IS NEVER SUCCESS",
];

export function ClaimMarquee({
  /** Substrate behind the field. Defaults to the terminal's near-black. */
  base = "#05070e",
  /** The single hue the field is lit in. */
  accent = "#4d7cfe",
  /** Ink for the claims themselves. Must clear the field by a real value gap. */
  ink = "var(--color-ink-2)",
}: {
  base?: string;
  accent?: string;
  ink?: string;
} = {}) {
  return (
    <div
      className="relative overflow-hidden py-4"
      style={{
        background: base,
        borderTop: "1px solid var(--pg-line, var(--color-line))",
        borderBottom: "1px solid var(--pg-line, var(--color-line))",
      }}
    >
      {/* The same lit field as the board header, so the strip belongs to the
          page rather than sitting on it as a flat band. It also removes the
          failure this replaces: a hard-coded surface colour that stayed dark
          when the page around it went light, leaving unreadable text. */}
      <HeroFieldGL intensity={0.85} base={base} accent={accent} />
      {/* Edges fade so the band reads as continuing past the viewport rather
          than starting and stopping at two hard vertical lines. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28 z-10"
        style={{ background: `linear-gradient(to right, ${base}, transparent)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28 z-10"
        style={{ background: `linear-gradient(to left, ${base}, transparent)` }}
      />

      <div className="relative z-10 flex w-max animate-[prism-marquee_38s_linear_infinite] motion-reduce:animate-none">
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1} className="flex items-center shrink-0">
            {CLAIMS.map((c) => (
              <li key={c} className="flex items-center shrink-0">
                <span className="num text-label-xs uppercase tracking-[0.07em] px-5 sm:px-7"
                  style={{ color: ink }}>
                  {c}
                </span>
                {/* A rounded cap, not a bare hairline: an unrounded rule used as
                    ornament is the cheap version of a separator. */}
                <span aria-hidden className="w-4 h-px rounded-full shrink-0"
                  style={{ background: ink, opacity: 0.4 }} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
