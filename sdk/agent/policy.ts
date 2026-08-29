/**
 * The spend policy an agent trades under.
 *
 * DELIBERATELY NOT `server-only`, and deliberately pure — same reasoning as
 * `grid.ts` and `atomicity.ts`. This is the module that decides whether
 * somebody else's model is allowed to move money, so it is the module that most
 * needs tests, and `server-only` throws the moment vitest imports it.
 *
 * WHY A POLICY OBJECT RATHER THAN CHECKS SPRINKLED THROUGH THE TOOLS. An agent
 * calls tools in a loop, and a limit enforced at the call site is a limit that
 * one new call site forgets. Every spend decision goes through `authorize()`
 * here, the ledger of what has been spent lives here, and a tool that forgets
 * to ask simply cannot spend — it has no other route to the executor.
 *
 * FAIL CLOSED, ALWAYS. Every unknown answers DENY: an unparseable size, a
 * missing budget, a market the caller did not name, a clock that went backwards.
 * The cost of a wrong deny is an agent that stops. The cost of a wrong allow is
 * somebody's collateral.
 */

/** Why a request was refused. Every denial is typed; none is a bare boolean. */
export type DenyReason =
  | "DRY_RUN"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "ORDER_ABOVE_MAX"
  | "BUDGET_EXHAUSTED"
  | "TRADE_COUNT_EXHAUSTED"
  | "COOLDOWN_ACTIVE"
  | "MARKET_NOT_ALLOWED"
  | "OUTCOME_NOT_ALLOWED"
  | "SIZE_NOT_FINITE"
  | "PRICE_NOT_A_PROBABILITY";

export interface AgentPolicy {
  /**
   * Total collateral this session may ever spend, in tUSDC.
   * Not per-order and not per-day: the whole session's ceiling.
   */
  budget: number;
  /** Largest single order, in contracts. */
  maxOrderContracts: number;
  /** How many orders this session may place at all. */
  maxTrades: number;
  /** Minimum gap between two orders, in ms. Zero disables it. */
  cooldownMs: number;
  /** Wall-clock life of the session, in ms. */
  ttlMs: number;
  /**
   * Market ids the agent may touch. EMPTY MEANS EMPTY — not "all". An
   * allowlist that silently means everything when unset is how a scoping bug
   * becomes an unscoped agent.
   */
  allowedMarketIds: string[];
  /** Outcomes the agent may take. Same rule: empty is empty. */
  allowedOutcomes: ("YES" | "NO")[];
  /** When true nothing is ever signed, whatever else says. */
  dryRun: boolean;
}

/** Sensible, small, and deliberately not generous. */
export const DEFAULT_POLICY: Omit<AgentPolicy, "allowedMarketIds"> = {
  budget: 5,
  maxOrderContracts: 1,
  maxTrades: 10,
  cooldownMs: 3_000,
  ttlMs: 60 * 60 * 1000,
  allowedOutcomes: ["YES", "NO"],
  // The default is the safe one. Arming a session is an explicit act.
  dryRun: true,
};

export interface AgentState {
  startedAt: number;
  spent: number;
  trades: number;
  lastTradeAt: number | null;
  revoked: boolean;
}

export const newState = (now = Date.now()): AgentState => ({
  startedAt: now,
  spent: 0,
  trades: 0,
  lastTradeAt: null,
  revoked: false,
});

export interface AuthorizeRequest {
  marketId: string;
  outcome: "YES" | "NO";
  /** Contracts. */
  size: number;
  /** Probability in (0,1) the order would cross at. */
  price: number;
}

export type Authorization =
  | {
      allowed: true;
      /** Collateral this order commits, in tUSDC. */
      cost: number;
      /** What remains of the budget AFTER this order, if it fills. */
      budgetRemaining: number;
      tradesRemaining: number;
    }
  | { allowed: false; reason: DenyReason; detail: string };

const deny = (reason: DenyReason, detail: string): Authorization => ({
  allowed: false,
  reason,
  detail,
});

/**
 * Decide whether one order may be placed.
 *
 * Pure: it reads state and returns a verdict, and never mutates. `commit()`
 * below records a spend that actually happened. Splitting them matters — an
 * order that is authorized and then fails to fill must not consume budget, and
 * a function that did both could not express that.
 */
export function authorize(
  policy: AgentPolicy,
  state: AgentState,
  req: AuthorizeRequest,
  now = Date.now(),
): Authorization {
  if (state.revoked) return deny("SESSION_REVOKED", "This session was revoked.");

  if (now - state.startedAt > policy.ttlMs)
    return deny(
      "SESSION_EXPIRED",
      `Session TTL of ${Math.round(policy.ttlMs / 60000)}m has elapsed.`,
    );

  // Numbers first: a non-finite size would sail through every comparison below,
  // because NaN is neither above nor below any bound.
  if (!Number.isFinite(req.size) || req.size <= 0)
    return deny("SIZE_NOT_FINITE", "Size must be a positive, finite number of contracts.");
  if (!Number.isFinite(req.price) || !(req.price > 0 && req.price < 1))
    return deny("PRICE_NOT_A_PROBABILITY", "Price must be strictly between 0 and 1.");

  if (!policy.allowedMarketIds.includes(req.marketId))
    return deny(
      "MARKET_NOT_ALLOWED",
      "That market is not in this session's allowlist.",
    );
  if (!policy.allowedOutcomes.includes(req.outcome))
    return deny("OUTCOME_NOT_ALLOWED", `This session may not take ${req.outcome}.`);

  if (req.size > policy.maxOrderContracts)
    return deny(
      "ORDER_ABOVE_MAX",
      `Order of ${req.size} exceeds the per-order cap of ${policy.maxOrderContracts}.`,
    );

  if (state.trades >= policy.maxTrades)
    return deny(
      "TRADE_COUNT_EXHAUSTED",
      `This session has already placed its ${policy.maxTrades} permitted orders.`,
    );

  if (
    policy.cooldownMs > 0 &&
    state.lastTradeAt !== null &&
    now - state.lastTradeAt < policy.cooldownMs
  )
    return deny(
      "COOLDOWN_ACTIVE",
      `${Math.ceil((policy.cooldownMs - (now - state.lastTradeAt)) / 1000)}s remain before the next order.`,
    );

  const cost = req.size * req.price;
  const after = state.spent + cost;
  if (after > policy.budget)
    return deny(
      "BUDGET_EXHAUSTED",
      `This order costs ${cost.toFixed(4)}; ${(policy.budget - state.spent).toFixed(4)} of the ${policy.budget} budget remains.`,
    );

  // Checked LAST on purpose. A dry-run session should still report exactly why
  // an order would have been refused, so the operator learns about a broken
  // policy before arming it rather than after.
  if (policy.dryRun)
    return deny("DRY_RUN", "This session is dry-run; nothing will be signed.");

  return {
    allowed: true,
    cost,
    budgetRemaining: policy.budget - after,
    tradesRemaining: policy.maxTrades - state.trades - 1,
  };
}

/**
 * Record a spend that actually happened.
 *
 * Takes the FILLED cost, not the authorized one. An IOC order can fill
 * partially or not at all, and charging the budget for size that never traded
 * would throttle an agent for orders the venue rejected.
 */
export function commit(state: AgentState, filledCost: number, now = Date.now()): AgentState {
  const cost = Number.isFinite(filledCost) && filledCost > 0 ? filledCost : 0;
  return {
    ...state,
    spent: state.spent + cost,
    // A submitted order counts against the trade budget even when it does not
    // fill: it consumed a nonce, gas, and a slot on the venue.
    trades: state.trades + 1,
    lastTradeAt: now,
  };
}

export const revoke = (state: AgentState): AgentState => ({ ...state, revoked: true });

/** What an operator, or the agent itself, should be able to read at any moment. */
export function describe(policy: AgentPolicy, state: AgentState, now = Date.now()) {
  return {
    armed: !policy.dryRun && !state.revoked,
    dryRun: policy.dryRun,
    revoked: state.revoked,
    budget: policy.budget,
    spent: Number(state.spent.toFixed(6)),
    budgetRemaining: Number((policy.budget - state.spent).toFixed(6)),
    trades: state.trades,
    tradesRemaining: Math.max(0, policy.maxTrades - state.trades),
    maxOrderContracts: policy.maxOrderContracts,
    allowedMarkets: policy.allowedMarketIds.length,
    allowedOutcomes: policy.allowedOutcomes,
    expiresInMs: Math.max(0, policy.ttlMs - (now - state.startedAt)),
  };
}
