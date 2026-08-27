"use client";

/**
 * A window's remaining life, ticking, with a status that agrees with it.
 *
 * WHAT WAS WRONG. /structures computed `left = expiry - now` once on the server
 * and rendered it as static text, next to a "LIVE" chip that was hard-coded on
 * for every routable card. Observed in production: four cards reading LIVE with
 * CLOSES IN 0m 0s in red, under a header claiming 4 ROUTABLE. The venue now
 * lists 60s windows, so a server-rendered countdown is wrong within seconds of
 * paint, and the page contradicted itself on screen.
 *
 * cache.ts already documents the fix as the design — "countdowns tick
 * client-side from the snapshot's own fetchedAt so a cached snapshot shows a
 * correct clock". The trade terminal does it. This page did not.
 *
 * The first frame is computed in the initialiser, so the content is correct
 * before any interval fires. A backgrounded or throttled tab shows a stale
 * countdown, never a blank one, and nothing here is gated on an effect running.
 */

import { useEffect, useState } from "react";
import { Chip, cx } from "@/components/ui";
import { headroomSec } from "@sdk/venue/types";

const nowSec = () => Math.floor(Date.now() / 1000);

function useSecondsLeft(expiry: number): number {
  const [left, setLeft] = useState(() => expiry - nowSec());
  useEffect(() => {
    const id = setInterval(() => setLeft(expiry - nowSec()), 1000);
    return () => clearInterval(id);
  }, [expiry]);
  return left;
}

/** Status chip that tells the truth about the window it sits next to. */
export function WindowChip({ expiry, intervalSec }: { expiry: number; intervalSec: number }) {
  const left = useSecondsLeft(expiry);
  const headroom = headroomSec(intervalSec);

  if (left <= 0) return <Chip tone="down">Closed</Chip>;
  if (left <= headroom) return <Chip tone="warn">Closing</Chip>;
  return (
    <Chip tone="up" live>
      Live
    </Chip>
  );
}

/** The countdown itself, coloured by how much room is actually left. */
export function WindowCountdown({
  expiry,
  intervalSec,
}: {
  expiry: number;
  intervalSec: number;
}) {
  const left = useSecondsLeft(expiry);
  const headroom = headroomSec(intervalSec);

  if (left <= 0) return <span className="num text-[13px] text-down mt-1 block">closed</span>;

  return (
    <span
      className={cx(
        "num text-[13px] mt-1 block",
        left <= headroom ? "text-warn" : "text-ink",
      )}
    >
      {Math.floor(left / 60)}m {left % 60}s
    </span>
  );
}
