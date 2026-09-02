"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock seconds, ticking.
 *
 * The first frame is already correct, so nothing rendered from this depends on
 * the interval ever firing — a throttled or backgrounded tab shows a stale
 * countdown, not a blank one.
 *
 * THE SEED MUST COME FROM THE SERVER. This used to initialise from
 * `Date.now()`, which runs twice — once while the server renders the HTML and
 * again while React hydrates — so the two disagreed by however long the
 * response took, and React threw "server rendered text didn't match the
 * client" and re-rendered the whole tree. Passing the server's clock in makes
 * the first client render byte-identical to the server's; the effect then
 * corrects to the real local clock on mount, before the first tick.
 *
 * A tiny clock skew is not worth an extra state variable to hide: the seed is
 * at most a page-load old, and the effect below fixes it immediately.
 */
export function useCountdown(seedSeconds: number): number {
  const [now, setNow] = useState(seedSeconds);
  useEffect(() => {
    // Correct to the client's own clock first — the seed is the server's, and
    // it is already slightly stale by the time this runs.
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export type ExpiryPhase = "open" | "closing" | "imminent" | "expired" | "none";

/**
 * Where a window sits relative to its own expiry.
 *
 * `closing` starts at the venue's headroom requirement — the point past which
 * an order can lock between snapshot and send. `imminent` is the last ten
 * seconds, where the honest answer is "do not start a trade now".
 */
export function expiryPhase(secondsLeft: number, headroom: number): ExpiryPhase {
  if (secondsLeft <= 0) return "expired";
  if (secondsLeft <= 10) return "imminent";
  if (secondsLeft <= headroom) return "closing";
  return "open";
}
