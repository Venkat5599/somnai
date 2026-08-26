import "server-only";

/**
 * Abuse guards for the signing surface.
 *
 * The deployed demo signs with ONE shared burner. Every server action that can
 * move funds is therefore, in effect, an open endpoint spending a wallet the
 * operator owns. The per-order size cap limits damage per call; it does nothing
 * about call VOLUME. A trivial loop could empty the wallet in seconds and every
 * later visitor would meet INSUFFICIENT_COLLATERAL — the demo would break
 * itself.
 *
 * Two layers, deliberately different in kind:
 *
 *   1. RATE  — per-caller, in-memory. Cheap, and honest about being
 *              best-effort: serverless runs many instances and this map is not
 *              shared between them. It stops a naive loop, not a distributed
 *              attacker.
 *
 *   2. SPEND — a floor on the wallet's own on-chain balance. This one DOES hold
 *              across instances, because the source of truth is the chain
 *              rather than process memory. It is the guard that actually
 *              protects the funds.
 *
 * For real multi-user traffic neither is the answer: users should sign with
 * their own wallets, at which point there is no shared spend surface at all.
 * These exist so a public demo cannot be trivially drained.
 */

import { COLLATERAL, resolveVenueConfig, type VenueConfig } from "@/lib/venue/config";
import { readBalances } from "./execution";

/* ------------------------------------------------------------------ */
/* 1. Rate                                                             */
/* ------------------------------------------------------------------ */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Requests allowed per window, per caller. */
const RATE_LIMIT = Number(process.env.PRISM_RATE_LIMIT ?? "5");
const RATE_WINDOW_MS = Number(process.env.PRISM_RATE_WINDOW_MS ?? "60000");

/** Keep the map from growing without bound under many distinct callers. */
function sweep(now: number) {
  if (buckets.size < 5_000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function checkRate(caller: string): RateVerdict {
  const now = Date.now();
  sweep(now);

  const b = buckets.get(caller);
  if (!b || b.resetAt <= now) {
    buckets.set(caller, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1, retryAfterSec: 0 };
  }

  if (b.count >= RATE_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
    };
  }

  b.count += 1;
  return { allowed: true, remaining: RATE_LIMIT - b.count, retryAfterSec: 0 };
}

/* ------------------------------------------------------------------ */
/* 2. Spend floor                                                      */
/* ------------------------------------------------------------------ */

/**
 * Refuse to spend below this collateral balance.
 *
 * Read from chain, so it holds no matter how many instances are serving. Keeps
 * the demo wallet solvent for the next visitor rather than letting one caller
 * take it to zero.
 */
const RESERVE = Number(process.env.PRISM_RESERVE ?? "400");

export interface SpendVerdict {
  allowed: boolean;
  balance: number | null;
  reserve: number;
  reason?: string;
}

export async function checkSpend(
  estimatedCost: number,
  config: VenueConfig = resolveVenueConfig(),
): Promise<SpendVerdict> {
  const bal = await readBalances(config).catch(() => null);
  if (!bal) {
    // Could not read the balance. Refuse rather than assume — an unreadable
    // balance is not a green light to spend.
    return {
      allowed: false,
      balance: null,
      reserve: RESERVE,
      reason: "Wallet balance could not be read, so spending is withheld.",
    };
  }

  const after = bal.collateral - estimatedCost;
  if (after < RESERVE) {
    return {
      allowed: false,
      balance: bal.collateral,
      reserve: RESERVE,
      reason:
        `This deployment keeps a ${RESERVE} ${COLLATERAL.symbol} reserve so the ` +
        `shared demo wallet stays solvent. Balance ${bal.collateral.toFixed(4)}, ` +
        `this order would leave ${after.toFixed(4)}.`,
    };
  }

  return { allowed: true, balance: bal.collateral, reserve: RESERVE };
}

/* ------------------------------------------------------------------ */
/* Caller identity                                                     */
/* ------------------------------------------------------------------ */

/**
 * Best-effort caller key from proxy headers.
 *
 * Spoofable, and treated as such: this keys a courtesy rate limit, never an
 * authorization decision. The spend floor is what actually protects funds.
 */
export async function callerKey(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}
