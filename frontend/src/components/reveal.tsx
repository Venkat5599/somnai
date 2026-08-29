"use client";

/**
 * Staged entrance that CANNOT hide content.
 *
 * The reference block this replaces (ui-layouts `hero-financial`) drives its
 * hero through a `TimelineAnimation` whose hidden state is
 * `{ opacity: 0, filter: 'blur(20px)' }`, applied as `initial='hidden'` and
 * lifted only when `useInView` fires. That is the single most damaging motion
 * mistake there is: when the reveal does not fire — backgrounded tab, throttled
 * animation engine, a hydration hiccup, a screenshot pass, reduced-motion
 * settings, JS disabled — the content is simply GONE and the hero renders as an
 * empty void. A beautifully animated page that sometimes renders blank is worse
 * than a static one.
 *
 * So this animates POSITION ONLY, from a fully opaque starting state. Every
 * child is in the DOM, at full opacity, from the first paint. If motion never
 * mounts, never runs, or is disabled, the reader sees the finished layout —
 * they just do not see it arrive. The motion is a bonus on top of a page that
 * is already correct, which is the only shape an entrance animation is allowed
 * to take.
 *
 * `prefers-reduced-motion` collapses the travel to zero rather than disabling
 * the component, so the same markup renders either way.
 */

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function Reveal({
  children,
  /** Stagger index. Each step delays by 70ms — enough to read as a sequence. */
  step = 0,
  /** Pixels travelled. Small on purpose: this is settling, not sliding. */
  distance = 10,
  className,
}: {
  children: ReactNode;
  step?: number;
  distance?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      // opacity is ABSENT from both states by design — see the file comment.
      // The element is opaque before, during and after; only `y` moves.
      initial={{ y: reduced ? 0 : distance }}
      animate={{ y: 0 }}
      transition={{
        delay: reduced ? 0 : step * 0.07,
        duration: reduced ? 0 : 0.5,
        // A single decisive ease-out. No spring bounce: this is an instrument,
        // and instruments settle rather than wobble.
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
