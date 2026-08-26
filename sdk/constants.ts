/**
 * Venue execution constants.
 *
 * Kept in a plain module (no "use client") so both server and client code can
 * read the same numbers. Values that a real deployment reads off `GET /markets`
 * at runtime rather than hard-coding, because venue parameters move.
 */

/** Price tick on an 18-decimal binary venue, in probability units. */
export const TICK = 0.005;

/** Lot size, in contracts. */
export const LOT = 1;
