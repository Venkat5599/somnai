import "server-only";

/**
 * The PRISM agent SDK.
 *
 * A typed client a developer can drop into their own agent, bot or backend
 * without adopting MCP. Same capabilities the terminal has, same policy engine
 * the MCP server enforces — MCP is one transport over this surface, not a
 * parallel implementation.
 *
 * WHY THIS EXISTS SEPARATELY FROM `sdk/dreamdex/*`. Those modules are the raw
 * venue adapter: powerful, unbounded, and correct to call directly if you are
 * writing the terminal. An AGENT is different — it acts in a loop, on its own
 * judgement, and the failure mode is not a wrong trade but a thousand of them.
 * So this surface is deliberately narrower than the one underneath it:
 *
 *   - every method that can spend goes through `authorize()` first, and the
 *     ledger of what has been spent lives in the session rather than in the
 *     caller. There is no way to place an order that skips it.
 *   - nothing throws for an ordinary refusal. A denied trade returns a typed
 *     result, because an agent that has to catch exceptions to learn its budget
 *     is an agent that will get it wrong.
 *   - the venue's own gates still apply underneath. This narrows; it never
 *     widens.
 *
 * USAGE
 *
 *   const agent = createAgent({
 *     budget: 5,
 *     maxOrderContracts: 1,
 *     allowedMarketIds: [id],
 *     dryRun: false,
 *   });
 *
 *   const markets = await agent.markets();
 *   const quote   = await agent.quote(id, "YES", 1);
 *   const result  = await agent.buy(id, "YES", 1);   // policy-gated
 *   agent.state();                                    // budget, spend, trades
 */

import { getMarketSnapshot, exchange } from "@sdk/venue/markets";
import { resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { isRoutable, type EventMarket, type Outcome } from "@sdk/venue/types";
import {
  validateOrder,
  submitOrder,
  verifyExecution,
  preflightSnapshot,
  explorerTx,
} from "@sdk/dreamdex/execution";
import { planRoll, executeRoll } from "@sdk/dreamdex/roll";
import { findClaimable, claim } from "@sdk/dreamdex/settlement";
import { restingOrders, cancelOrders } from "@sdk/dreamdex/cancel";
import {
  DEFAULT_POLICY,
  authorize,
  commit,
  describe,
  newState,
  revoke,
  type AgentPolicy,
  type AgentState,
  type DenyReason,
} from "./policy";

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/**
 * Refusals are VALUES, never exceptions.
 *
 * An agent reasoning about its own budget should read a field, not catch a
 * throw. Every outcome below is inspectable without a try/catch.
 */
export type AgentResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "POLICY"; reason: DenyReason; detail: string }
  | { ok: false; kind: "VENUE"; reason: string; detail: string }
  | { ok: false; kind: "ERROR"; reason: string; detail: string };

const denyPolicy = <T>(reason: DenyReason, detail: string): AgentResult<T> => ({
  ok: false,
  kind: "POLICY",
  reason,
  detail,
});
const denyVenue = <T>(reason: string, detail: string): AgentResult<T> => ({
  ok: false,
  kind: "VENUE",
  reason,
  detail,
});

export interface Quote {
  marketId: string;
  outcome: Outcome;
  /** Best ask, i.e. what a taker pays. */
  price: number;
  /** Contracts resting at or better than the best level. */
  depth: number;
  size: number;
  cost: number;
  /** Whether the policy would permit this trade right now. */
  permitted: boolean;
  blocker: DenyReason | null;
}

export interface Fill {
  marketId: string;
  outcome: Outcome;
  requested: number;
  filled: number;
  price: number;
  status: "VERIFIED_EXECUTED" | "VERIFIED_FAILED" | "PENDING" | "UNKNOWN";
  txHash: string | null;
  explorer: string | null;
  evidence: string[];
}

/* ------------------------------------------------------------------ */

export interface AgentOptions extends Partial<AgentPolicy> {
  config?: VenueConfig;
}

export function createAgent(options: AgentOptions = {}) {
  const config = options.config ?? resolveVenueConfig();

  const policy: AgentPolicy = {
    ...DEFAULT_POLICY,
    allowedMarketIds: [],
    ...options,
    // The venue's own dry-run wins. An agent cannot arm a deployment that has
    // globally disarmed itself.
    dryRun: (options.dryRun ?? DEFAULT_POLICY.dryRun) || config.dryRun,
  };

  let state: AgentState = newState();

  /**
   * A snapshot cached for a beat.
   *
   * Every method used to re-pull the registry, which is both slow and RACY: an
   * agent that lists markets and then quotes one can have the window expire
   * between those two lines, and the quote comes back MARKET_NOT_FOUND for a
   * market the client itself just returned. Observed live on a 1m window.
   *
   * Two seconds is long enough to make a read-then-act pair coherent and far
   * shorter than any window, so nothing stale can be traded on.
   */
  let cached: { at: number; snap: Awaited<ReturnType<typeof getMarketSnapshot>> } | null = null;
  const SNAP_TTL_MS = 2_000;

  async function snapshot() {
    if (cached && Date.now() - cached.at < SNAP_TTL_MS) return cached.snap;
    const snap = await getMarketSnapshot(config);
    cached = { at: Date.now(), snap };
    return snap;
  }

  /** Best ask and depth for one leg, or null when nothing rests. */
  async function book(market: EventMarket, outcome: Outcome) {
    try {
      const ob = await exchange(config).fetchOrderBook(`${market.symbol}#${outcome}`);
      const asks = (ob.asks ?? []) as [number, number][];
      if (!asks[0]) return null;
      return { price: asks[0][0], depth: asks.reduce((n, [, s]) => n + s, 0) };
    } catch {
      return null;
    }
  }

  const findMarket = async (marketId: string) =>
    (await snapshot()).all.find((m) => m.marketId === marketId) ?? null;

  return {
    /** The policy and what remains of it. Safe to expose to the model. */
    state: () => describe(policy, state),

    /** Stop this session spending. One-way. */
    revoke: () => {
      state = revoke(state);
      return describe(policy, state);
    },

    /** Live markets. `routableOnly` is the default because the rest cannot trade. */
    async markets(routableOnly = true): Promise<EventMarket[]> {
      const snap = await snapshot();
      return routableOnly ? snap.routable : snap.active;
    },

    /**
     * Price a trade WITHOUT committing to it.
     *
     * Reports `permitted` alongside the price, so an agent can plan against its
     * own budget instead of discovering the limit by being refused.
     */
    async quote(marketId: string, outcome: Outcome, size: number): Promise<AgentResult<Quote>> {
      const market = await findMarket(marketId);
      if (!market) return denyVenue("MARKET_NOT_FOUND", "Not in the current registry.");

      const b = await book(market, outcome);
      if (!b)
        return denyVenue("NO_BOOK_LIQUIDITY", "Nothing is resting on this outcome.");

      const auth = authorize(policy, state, { marketId, outcome, size, price: b.price });
      return {
        ok: true,
        data: {
          marketId,
          outcome,
          price: b.price,
          depth: b.depth,
          size,
          cost: size * b.price,
          permitted: auth.allowed,
          blocker: auth.allowed ? null : auth.reason,
        },
      };
    },

    /**
     * Buy one outcome.
     *
     * The ONLY spending path on this client. It asks the policy, then the venue,
     * then verifies from chain — and charges the budget for what actually
     * filled rather than what was requested.
     */
    async buy(marketId: string, outcome: Outcome, size: number): Promise<AgentResult<Fill>> {
      const market = await findMarket(marketId);
      if (!market) return denyVenue("MARKET_NOT_FOUND", "Not in the current registry.");
      if (!isRoutable(market))
        return denyVenue("MARKET_NOT_ROUTABLE", "This window cannot accept orders.");

      const b = await book(market, outcome);
      if (!b) return denyVenue("NO_BOOK_LIQUIDITY", "Nothing is resting on this outcome.");

      const auth = authorize(policy, state, { marketId, outcome, size, price: b.price });
      if (!auth.allowed) return denyPolicy(auth.reason, auth.detail);

      const v = await validateOrder(
        { marketId, outcome, side: "buy", amount: size },
        market,
        { bids: [], asks: [[b.price, b.depth]] },
        config,
      );
      if (!v.ok) return denyVenue(v.reason, v.detail);

      const before = await preflightSnapshot(config);
      const submitted = await submitOrder(v, "buy", config);
      const verdict = await verifyExecution(submitted, before, config);

      const filled = submitted.filled ?? 0;
      state = commit(state, filled * v.price);

      const txHash = "transactionHash" in verdict ? verdict.transactionHash : null;
      return {
        ok: true,
        data: {
          marketId,
          outcome,
          requested: size,
          filled,
          price: v.price,
          status: verdict.status,
          txHash,
          explorer: txHash ? explorerTx(txHash, config) : null,
          evidence: verdict.evidence,
        },
      };
    },

    /** Whether a view can be carried into the successor window, and at what cost. */
    plan: (marketId: string, outcome: Outcome, size: number) =>
      planRoll({ marketId, outcome, size }, config),

    /** Carry a view forward. Policy-gated against the successor's price. */
    async roll(marketId: string, outcome: Outcome, size: number) {
      const plan = await planRoll({ marketId, outcome, size }, config);
      if (!plan.ok || !plan.to)
        return denyVenue(plan.blocker ?? "NOT_ROUTABLE", plan.detail ?? "Cannot roll.");

      const auth = authorize(policy, state, {
        marketId: plan.to.marketId,
        outcome,
        size,
        price: plan.price ?? 0.5,
      });
      if (!auth.allowed) return denyPolicy(auth.reason, auth.detail);

      const r = await executeRoll({ marketId, outcome, size }, config);
      state = commit(state, r.filled * (plan.price ?? 0));
      return { ok: true as const, data: r };
    },

    /** Settled positions still redeemable. Collects funds, so it costs no budget. */
    claimable: (scan = 25) => findClaimable(scan, config),

    /** Redeem one. Refused when revoked or dry-run, never budget-charged. */
    async redeem(marketId: string) {
      if (state.revoked) return denyPolicy("SESSION_REVOKED", "This session was revoked.");
      if (policy.dryRun) return denyPolicy("DRY_RUN", "Nothing will be signed.");
      const row = (await findClaimable(25, config)).find((r) => r.marketId === marketId);
      if (!row) return denyVenue("NOTHING_TO_CLAIM", "No redeemable holding on that market.");
      return { ok: true as const, data: await claim(row, config) };
    },

    /** What is still resting, read from chain rather than the indexer. */
    open: (marketId: string) => restingOrders(marketId, config),

    /** Pull orders. Costs no budget — exiting should never be rate-limited. */
    async cancel(marketId: string, orderIds: string[]) {
      if (state.revoked) return denyPolicy("SESSION_REVOKED", "This session was revoked.");
      return { ok: true as const, data: await cancelOrders(marketId, orderIds, config) };
    },
  };
}

export type PrismAgent = ReturnType<typeof createAgent>;
