import { describe, it, expect } from "vitest";
import {
  checkFence,
  clampToGrant,
  issueGrant,
  redeemGrant,
  verifyGrant,
  type Grant,
} from "../sdk/agent/credential";

/**
 * Execution credentials a copy cannot use.
 *
 * The claim being tested is narrow and worth stating exactly: this is not
 * physically unclonable — there is no enclave here and the file can be copied.
 * It is clone-INEFFECTIVE and clone-EVIDENT. The assertions that matter are the
 * ones proving a second holder gains nothing and the first one finds out.
 */

const SECRET = "operator-secret-at-least-16-chars";
const claims = {
  budget: 5,
  maxOrderContracts: 1,
  maxTrades: 10,
  allowedMarketIds: ["0xa", "0xb"],
  expiresAt: Date.now() + 60_000,
};

describe("issue and verify", () => {
  it("verifies a grant it just issued", () => {
    expect(verifyGrant(issueGrant(claims, SECRET), SECRET).ok).toBe(true);
  });

  it("gives every grant a distinct id", () => {
    expect(issueGrant(claims, SECRET).grantId).not.toBe(issueGrant(claims, SECRET).grantId);
  });

  it("refuses a grant signed with a different secret", () => {
    const g = issueGrant(claims, SECRET);
    const r = verifyGrant(g, "a-completely-different-secret");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("GRANT_SIGNATURE_INVALID");
  });

  /**
   * The point of signing the CLAIMS rather than just the id: a copied grant
   * must not be editable into a bigger one.
   */
  it("refuses a grant whose budget was raised after signing", () => {
    const g = issueGrant(claims, SECRET);
    const tampered: Grant = { ...g, budget: 1_000_000 };
    const r = verifyGrant(tampered, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("GRANT_SIGNATURE_INVALID");
  });

  it("refuses a grant whose allowlist was widened after signing", () => {
    const g = issueGrant(claims, SECRET);
    const tampered: Grant = { ...g, allowedMarketIds: [...g.allowedMarketIds, "0xevil"] };
    expect(verifyGrant(tampered, SECRET).ok).toBe(false);
  });

  it("refuses a grant whose size or trade caps were raised", () => {
    const g = issueGrant(claims, SECRET);
    expect(verifyGrant({ ...g, maxOrderContracts: 99 }, SECRET).ok).toBe(false);
    expect(verifyGrant({ ...g, maxTrades: 99 }, SECRET).ok).toBe(false);
  });

  it("is insensitive to allowlist ORDER, so a valid grant stays valid", () => {
    const g = issueGrant(claims, SECRET);
    const reordered: Grant = { ...g, allowedMarketIds: [...g.allowedMarketIds].reverse() };
    expect(verifyGrant(reordered, SECRET).ok).toBe(true);
  });

  it("refuses an expired grant", () => {
    const g = issueGrant({ ...claims, expiresAt: Date.now() - 1 }, SECRET);
    const r = verifyGrant(g, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("GRANT_EXPIRED");
  });

  it("refuses malformed input rather than throwing", () => {
    for (const bad of [null, {}, { grantId: "x" }, { grantId: 1, sig: "a" }]) {
      const r = verifyGrant(bad as unknown as Grant, SECRET);
      expect(r.ok).toBe(false);
    }
  });

  it("refuses to issue against a weak operator secret", () => {
    expect(() => issueGrant(claims, "short")).toThrow();
  });
});

describe("the fence — why a copy gains nothing", () => {
  it("mints fence 1 on first redemption", () => {
    const g = issueGrant(claims, SECRET);
    const r = redeemGrant(g, null);
    expect(r.fence).toBe(1);
    expect(r.displacedPrevious).toBe(false);
  });

  it("authorises the holder that currently owns the lease", () => {
    const g = issueGrant(claims, SECRET);
    const a = redeemGrant(g, null);
    expect(checkFence(a.lease, { fence: a.fence, holder: a.holder }).ok).toBe(true);
  });

  /**
   * THE CENTRAL ASSERTION. Two processes redeem the same credential; the second
   * wins the lease and the first is refused on its next spend. They can never
   * both trade.
   */
  it("invalidates the first holder when a second redeems the same grant", () => {
    const g = issueGrant(claims, SECRET);
    const first = redeemGrant(g, null);
    const second = redeemGrant(g, first.lease);

    expect(second.fence).toBeGreaterThan(first.fence);
    expect(second.displacedPrevious).toBe(true);

    // The newcomer holds the lease.
    expect(checkFence(second.lease, { fence: second.fence, holder: second.holder }).ok).toBe(true);

    // The original is now stale, and told why.
    const r = checkFence(second.lease, { fence: first.fence, holder: first.holder });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("FENCE_STALE");
      expect(r.detail).toContain("displaced");
    }
  });

  it("keeps the fence strictly increasing across many redemptions", () => {
    const g = issueGrant(claims, SECRET);
    let lease = redeemGrant(g, null).lease;
    let last = lease.fence;
    for (let i = 0; i < 5; i++) {
      const r = redeemGrant(g, lease);
      expect(r.fence).toBeGreaterThan(last);
      last = r.fence;
      lease = r.lease;
    }
  });

  /**
   * A fence is a small integer and therefore guessable. The holder token is
   * what stops a guess from inheriting the lease.
   */
  it("refuses a correct fence presented with the wrong holder", () => {
    const g = issueGrant(claims, SECRET);
    const a = redeemGrant(g, null);
    const r = checkFence(a.lease, { fence: a.fence, holder: "f".repeat(32) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("HOLDER_MISMATCH");
  });

  it("refuses a fence ahead of the recorded lease, rather than trusting it", () => {
    const g = issueGrant(claims, SECRET);
    const a = redeemGrant(g, null);
    const r = checkFence(a.lease, { fence: a.fence + 5, holder: a.holder });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("FENCE_STALE");
  });

  it("refuses when no lease exists at all", () => {
    const r = checkFence(null, { fence: 1, holder: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("FENCE_UNKNOWN");
  });

  /**
   * A crashed holder must not lock the operator out of their own credential —
   * which is why redemption displaces rather than refuses.
   */
  it("lets the operator recover a lease left behind by a dead process", () => {
    const g = issueGrant(claims, SECRET);
    const dead = redeemGrant(g, null);
    const recovered = redeemGrant(g, dead.lease);
    expect(checkFence(recovered.lease, { fence: recovered.fence, holder: recovered.holder }).ok).toBe(true);
  });
});

describe("clampToGrant — a grant can only ever narrow", () => {
  const grant = issueGrant(claims, SECRET);

  it("lowers a policy that asks for more than the grant permits", () => {
    const c = clampToGrant(
      { budget: 500, maxOrderContracts: 50, maxTrades: 500, allowedMarketIds: ["0xa", "0xb"] },
      grant,
    );
    expect(c.budget).toBe(5);
    expect(c.maxOrderContracts).toBe(1);
    expect(c.maxTrades).toBe(10);
  });

  it("leaves a policy stricter than the grant alone", () => {
    const c = clampToGrant(
      { budget: 1, maxOrderContracts: 1, maxTrades: 2, allowedMarketIds: ["0xa"] },
      grant,
    );
    expect(c.budget).toBe(1);
    expect(c.maxTrades).toBe(2);
  });

  it("INTERSECTS the allowlist, never unions it", () => {
    const c = clampToGrant(
      { budget: 1, maxOrderContracts: 1, maxTrades: 1, allowedMarketIds: ["0xa", "0xNOTINGRANT"] },
      grant,
    );
    expect(c.allowedMarketIds).toEqual(["0xa"]);
  });

  it("yields an empty allowlist when nothing overlaps — permitting nothing", () => {
    const c = clampToGrant(
      { budget: 1, maxOrderContracts: 1, maxTrades: 1, allowedMarketIds: ["0xzzz"] },
      grant,
    );
    expect(c.allowedMarketIds).toEqual([]);
  });
});
