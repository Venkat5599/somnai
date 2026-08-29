import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLICY,
  authorize,
  commit,
  describe as describePolicy,
  newState,
  revoke,
  type AgentPolicy,
} from "../sdk/agent/policy";

/**
 * The guardrails an agent trades under.
 *
 * This is the module that decides whether somebody else's model may move money,
 * so the assertions that matter are the DENIALS. A policy engine that has only
 * been tested on the happy path is indistinguishable from no policy at all.
 */

const policy = (over: Partial<AgentPolicy> = {}): AgentPolicy => ({
  ...DEFAULT_POLICY,
  allowedMarketIds: ["0xmarket"],
  dryRun: false,
  ...over,
});

const req = (over: Partial<Parameters<typeof authorize>[2]> = {}) => ({
  marketId: "0xmarket",
  outcome: "YES" as const,
  size: 1,
  price: 0.5,
  ...over,
});

describe("the happy path", () => {
  it("allows an order inside every limit", () => {
    const a = authorize(policy(), newState(), req());
    expect(a.allowed).toBe(true);
    if (a.allowed) {
      expect(a.cost).toBeCloseTo(0.5);
      expect(a.budgetRemaining).toBeCloseTo(4.5);
    }
  });
});

describe("the caps", () => {
  it("refuses an order above the per-order size cap", () => {
    const a = authorize(policy({ maxOrderContracts: 1 }), newState(), req({ size: 2 }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("ORDER_ABOVE_MAX");
  });

  it("refuses when the order would exceed the remaining budget", () => {
    const s = { ...newState(), spent: 4.8 };
    const a = authorize(policy({ budget: 5 }), s, req({ size: 1, price: 0.5 }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("BUDGET_EXHAUSTED");
  });

  it("allows an order that lands exactly ON the budget", () => {
    const s = { ...newState(), spent: 4.5 };
    expect(authorize(policy({ budget: 5 }), s, req({ size: 1, price: 0.5 })).allowed).toBe(true);
  });

  it("refuses once the trade count is spent", () => {
    const s = { ...newState(), trades: 10 };
    const a = authorize(policy({ maxTrades: 10 }), s, req());
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("TRADE_COUNT_EXHAUSTED");
  });

  it("enforces the cooldown between orders", () => {
    const now = 1_000_000;
    const s = { ...newState(now - 500), lastTradeAt: now - 500 };
    const a = authorize(policy({ cooldownMs: 3000 }), s, req(), now);
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("COOLDOWN_ACTIVE");
  });

  it("releases the cooldown once it has elapsed", () => {
    const now = 1_000_000;
    const s = { ...newState(now - 9000), lastTradeAt: now - 4000 };
    expect(authorize(policy({ cooldownMs: 3000 }), s, req(), now).allowed).toBe(true);
  });
});

describe("scope", () => {
  it("refuses a market outside the allowlist", () => {
    const a = authorize(policy(), newState(), req({ marketId: "0xother" }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("MARKET_NOT_ALLOWED");
  });

  /**
   * The assertion that matters most here. An allowlist that means "everything"
   * when it is empty turns a scoping bug into an unscoped agent — so empty
   * means empty, and this test is what keeps it that way.
   */
  it("treats an EMPTY allowlist as permitting nothing, never everything", () => {
    const a = authorize(policy({ allowedMarketIds: [] }), newState(), req());
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("MARKET_NOT_ALLOWED");
  });

  it("refuses an outcome the session may not take", () => {
    const a = authorize(policy({ allowedOutcomes: ["YES"] }), newState(), req({ outcome: "NO" }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("OUTCOME_NOT_ALLOWED");
  });

  it("treats an empty outcome list the same way", () => {
    expect(authorize(policy({ allowedOutcomes: [] }), newState(), req()).allowed).toBe(false);
  });
});

describe("fail closed on nonsense", () => {
  /**
   * NaN is neither above nor below any bound, so an unchecked non-finite size
   * passes every comparison in the function. This is the case that would let an
   * agent through every cap at once.
   */
  it("refuses a NaN size rather than comparing it", () => {
    const a = authorize(policy(), newState(), req({ size: Number.NaN }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("SIZE_NOT_FINITE");
  });

  it("refuses Infinity, zero and negative sizes", () => {
    for (const size of [Number.POSITIVE_INFINITY, 0, -1])
      expect(authorize(policy(), newState(), req({ size })).allowed).toBe(false);
  });

  it("refuses a price that is not a probability", () => {
    for (const price of [0, 1, 1.5, -0.2, Number.NaN]) {
      const a = authorize(policy(), newState(), req({ price }));
      expect(a.allowed).toBe(false);
    }
  });
});

describe("session lifecycle", () => {
  it("refuses after the TTL elapses", () => {
    const now = 5_000_000;
    const s = newState(now - 10_000);
    const a = authorize(policy({ ttlMs: 5_000 }), s, req(), now);
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("SESSION_EXPIRED");
  });

  it("refuses everything once revoked, ahead of every other check", () => {
    const a = authorize(policy(), revoke(newState()), req());
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("SESSION_REVOKED");
  });

  it("defaults to dry-run, so arming is an explicit act", () => {
    expect(DEFAULT_POLICY.dryRun).toBe(true);
    const a = authorize(policy({ dryRun: true }), newState(), req());
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("DRY_RUN");
  });

  /**
   * Dry-run is checked LAST so a refusal still names the real problem. An
   * operator testing a policy should learn it is broken before arming it.
   */
  it("reports the REAL blocker in dry-run, not just DRY_RUN", () => {
    const a = authorize(policy({ dryRun: true }), newState(), req({ marketId: "0xother" }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("MARKET_NOT_ALLOWED");
  });
});

describe("commit", () => {
  it("charges the FILLED cost, not the authorized one", () => {
    // Authorized for 1.0, filled 0.4 — an IOC that partially filled.
    const s = commit(newState(), 0.4);
    expect(s.spent).toBeCloseTo(0.4);
  });

  it("counts a trade even when nothing filled", () => {
    // It still consumed a nonce, gas and a slot on the venue.
    const s = commit(newState(), 0);
    expect(s.trades).toBe(1);
    expect(s.spent).toBe(0);
  });

  it("ignores a negative or non-finite fill rather than crediting budget back", () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(commit(newState(), bad).spent).toBe(0);
  });

  it("accumulates across orders and eventually exhausts the budget", () => {
    let s = newState();
    const p = policy({ budget: 1, cooldownMs: 0, maxTrades: 99 });
    for (let i = 0; i < 2; i++) {
      const a = authorize(p, s, req({ size: 1, price: 0.5 }));
      expect(a.allowed).toBe(true);
      s = commit(s, 0.5);
    }
    const a = authorize(p, s, req({ size: 1, price: 0.5 }));
    expect(a.allowed).toBe(false);
    if (!a.allowed) expect(a.reason).toBe("BUDGET_EXHAUSTED");
  });
});

describe("describe()", () => {
  it("reports armed only when the session is live and not dry-run", () => {
    expect(describePolicy(policy({ dryRun: true }), newState()).armed).toBe(false);
    expect(describePolicy(policy(), revoke(newState())).armed).toBe(false);
    expect(describePolicy(policy(), newState()).armed).toBe(true);
  });

  it("never reports a negative remaining budget", () => {
    const d = describePolicy(policy({ budget: 1 }), { ...newState(), trades: 99 });
    expect(d.tradesRemaining).toBeGreaterThanOrEqual(0);
  });
});
