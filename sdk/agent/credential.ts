/**
 * Agent execution credentials that a copy cannot use.
 *
 * WHAT THIS IS NOT. There is no TPM, no secure enclave and no PUF in a bun
 * process, so nothing here is PHYSICALLY unclonable — a claim of that kind on
 * this stack would be marketing. The file can be copied. What it cannot be is
 * USED twice.
 *
 * WHAT IT IS. A single-redemption grant plus a fencing token, which is the
 * standard answer to exactly this problem in distributed locking:
 *
 *   - a grant is redeemed ONCE. Redemption mints a fence — a strictly
 *     increasing integer — and rewrites the lease.
 *   - every spend must present the CURRENT fence. A stale one is refused.
 *   - a second process redeeming the same grant mints a HIGHER fence, which
 *     silently invalidates the first. Two clones can never both spend, and the
 *     loser finds out on its next write rather than quietly double-trading.
 *
 * So the property is clone-INEFFECTIVE and clone-EVIDENT. Copy the credential
 * and you do not get a second budget; you get a fight over one lease that
 * exactly one party wins, and the other is told it lost.
 *
 * THE GRANT IS BOUND TO ITS POLICY. The hmac covers the budget, caps and
 * allowlist, so a copied grant cannot be edited to raise its own limits — the
 * operator's secret is required to re-sign, and the agent never sees it.
 *
 * Pure and dependency-light on purpose: this decides whether an execution is
 * authorised at all, so it must be testable without a process, a filesystem or
 * a clock. All I/O lives in the caller.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/** The policy fields the grant commits to. Editing any of them breaks the hmac. */
export interface GrantClaims {
  grantId: string;
  budget: number;
  maxOrderContracts: number;
  maxTrades: number;
  allowedMarketIds: string[];
  /** Unix ms. A grant is refused after this regardless of everything else. */
  expiresAt: number;
}

export interface Grant extends GrantClaims {
  /** HMAC over the claims, keyed by the operator's secret. */
  sig: string;
}

/** What the operator persists. One record per grant. */
export interface Lease {
  grantId: string;
  /** Strictly increasing. The whole mechanism rests on this. */
  fence: number;
  /** Random per redemption, so a fence alone is not a credential. */
  holder: string;
  redeemedAt: number;
}

export type CredentialDenial =
  | "GRANT_MALFORMED"
  | "GRANT_SIGNATURE_INVALID"
  | "GRANT_EXPIRED"
  | "FENCE_STALE"
  | "FENCE_UNKNOWN"
  | "HOLDER_MISMATCH";

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

/**
 * Canonical serialisation of the claims.
 *
 * Field order is FIXED and the allowlist is sorted, so two grants with the same
 * meaning always produce the same bytes. Signing `JSON.stringify(obj)` directly
 * would make the signature depend on key insertion order, which is how a valid
 * grant starts failing verification for no visible reason.
 */
function canonical(c: GrantClaims): string {
  return JSON.stringify([
    c.grantId,
    c.budget,
    c.maxOrderContracts,
    c.maxTrades,
    [...c.allowedMarketIds].sort(),
    c.expiresAt,
  ]);
}

const mac = (secret: string, c: GrantClaims): string =>
  createHmac("sha256", secret).update(canonical(c)).digest("hex");

export function issueGrant(claims: Omit<GrantClaims, "grantId">, secret: string): Grant {
  if (!secret || secret.length < 16)
    throw new Error("Operator secret must be at least 16 characters.");
  const full: GrantClaims = { ...claims, grantId: randomBytes(12).toString("hex") };
  return { ...full, sig: mac(secret, full) };
}

/**
 * Verify a grant's signature and lifetime.
 *
 * Constant-time comparison: an hmac checked with `===` leaks its own bytes
 * through timing, one character at a time.
 */
export function verifyGrant(
  grant: Grant,
  secret: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: CredentialDenial } {
  if (
    !grant ||
    typeof grant.grantId !== "string" ||
    typeof grant.sig !== "string" ||
    !Number.isFinite(grant.budget) ||
    !Number.isFinite(grant.expiresAt) ||
    !Array.isArray(grant.allowedMarketIds)
  )
    return { ok: false, reason: "GRANT_MALFORMED" };

  const expected = mac(secret, grant);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(grant.sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: "GRANT_SIGNATURE_INVALID" };

  // Checked after the signature: an expired grant and a forged one should not
  // be distinguishable by which error comes back first.
  if (now >= grant.expiresAt) return { ok: false, reason: "GRANT_EXPIRED" };

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Redeem                                                              */
/* ------------------------------------------------------------------ */

export interface Redemption {
  lease: Lease;
  /** Present this on every spend. Useless once a later redemption exists. */
  fence: number;
  holder: string;
  /** True when this redemption displaced a live holder — worth alarming on. */
  displacedPrevious: boolean;
}

/**
 * Redeem a grant, minting a fence strictly greater than any before it.
 *
 * `previous` is whatever the operator has stored for this grant, or null on
 * first use. A second process redeeming the same grant lands here too, gets a
 * higher fence, and takes the lease — which is the point. It does not fail; it
 * WINS, and the earlier holder is invalidated the next time it tries to spend.
 * Refusing the newcomer instead would let a crashed process lock the operator
 * out of their own credential forever.
 */
export function redeemGrant(grant: Grant, previous: Lease | null, now = Date.now()): Redemption {
  const fence = (previous?.fence ?? 0) + 1;
  const holder = randomBytes(16).toString("hex");
  return {
    lease: { grantId: grant.grantId, fence, holder, redeemedAt: now },
    fence,
    holder,
    displacedPrevious: previous !== null,
  };
}

/**
 * Authorise one execution against the live lease.
 *
 * Both halves are required. The fence proves the holder is CURRENT; the holder
 * token proves it is the same process that redeemed — a fence is a small
 * integer, and an attacker who guessed it without the token would otherwise
 * inherit the lease.
 */
export function checkFence(
  live: Lease | null,
  presented: { fence: number; holder: string },
): { ok: true } | { ok: false; reason: CredentialDenial; detail: string } {
  if (!live) return { ok: false, reason: "FENCE_UNKNOWN", detail: "No lease exists for this grant." };

  if (presented.fence !== live.fence)
    return {
      ok: false,
      reason: "FENCE_STALE",
      detail:
        presented.fence < live.fence
          ? `This session was displaced: fence ${presented.fence} was superseded by ${live.fence}. Another process redeemed the same credential.`
          : `Fence ${presented.fence} is ahead of the recorded lease (${live.fence}); the lease store is behind or was tampered with.`,
    };

  const a = Buffer.from(live.holder);
  const b = Buffer.from(presented.holder);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return {
      ok: false,
      reason: "HOLDER_MISMATCH",
      detail: "Fence matches but the holder token does not.",
    };

  return { ok: true };
}

/** A grant is only as strong as its policy: never let it exceed the operator's. */
export function clampToGrant<T extends { budget: number; maxOrderContracts: number; maxTrades: number; allowedMarketIds: string[] }>(
  policy: T,
  grant: GrantClaims,
): T {
  return {
    ...policy,
    budget: Math.min(policy.budget, grant.budget),
    maxOrderContracts: Math.min(policy.maxOrderContracts, grant.maxOrderContracts),
    maxTrades: Math.min(policy.maxTrades, grant.maxTrades),
    // Intersection, never union: a grant can only ever narrow the scope.
    allowedMarketIds: policy.allowedMarketIds.filter((m) => grant.allowedMarketIds.includes(m)),
  };
}
