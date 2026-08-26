"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock seconds, ticking.
 *
 * The first frame is already correct, so nothing rendered from this depends on
 * the interval ever firing — a throttled or backgrounded tab shows a stale
 * countdown, not a blank one.
 */
export function useCountdown(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
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
