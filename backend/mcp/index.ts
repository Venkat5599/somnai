/**
 * PRISM as an MCP server: an agent can read the venue and trade it, under a
 * budget it cannot talk its way past.
 *
 *   bun --conditions react-server backend/mcp/index.ts
 *
 * WHY THE GUARDRAILS LIVE IN `sdk/agent/policy.ts` AND NOT HERE. An agent calls
 * tools in a loop, and a limit written at the call site is a limit the next tool
 * forgets. Every spend decision in this file goes through `authorize()`, the
 * ledger of what has been spent lives in the policy module, and `place_order`
 * has no other route to the executor. A tool that forgets to ask simply cannot
 * spend.
 *
 * WHAT THE MODEL CANNOT DO, and this is the point of the design:
 *
 *   - it cannot raise its own budget, size cap, trade count or TTL — the policy
 *     is fixed at process start from the environment, and no tool mutates it
 *   - it cannot reach a market outside the allowlist, and an EMPTY allowlist
 *     permits nothing rather than everything
 *   - it cannot arm a dry-run session; only the operator's environment can
 *   - it cannot un-revoke itself, and `revoke_session` is one-way
 *   - it cannot bypass the venue gates either: every order still goes through
 *     validateOrder → submitOrder → verifyExecution, so expiry headroom, the
 *     tick grid and chain verification apply exactly as they do in the UI
 *
 * The policy is the SECOND line. The first is that this process holds no key of
 * its own: it signs through the same executor path the terminal uses, which is
 * already single-writer and already guarded by an on-chain spend floor.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getMarketSnapshot, exchange } from "../../sdk/venue/markets";
import { resolveVenueConfig } from "../../sdk/venue/config";
import { isRoutable, headroomSec, type Outcome } from "../../sdk/venue/types";
import { validateOrder, submitOrder, verifyExecution, preflightSnapshot, explorerTx } from "../../sdk/dreamdex/execution";
import { findClaimable, claim } from "../../sdk/dreamdex/settlement";
import { planRoll, executeRoll } from "../../sdk/dreamdex/roll";
import { planBatch, executeBatch, type BatchLeg } from "../../sdk/dreamdex/batch";
import { restingOrders, cancelOrders, flatten } from "../../sdk/dreamdex/cancel";
import { getHistory } from "../../sdk/dreamdex/history";
import { verifyLifecycle } from "../../sdk/dreamdex/proof";
import { structureMatrix } from "../../sdk/venue/structures";
import { getPriceSnapshot } from "../../sdk/venue/prices";
import { readBalances } from "../../sdk/dreamdex/execution";
import {
  DEFAULT_POLICY,
  authorize,
  commit,
  describe as describePolicy,
  newState,
  revoke,
  type AgentPolicy,
} from "../../sdk/agent/policy";

const config = resolveVenueConfig();

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

/**
 * The policy is read ONCE, here, from the operator's environment. Nothing the
 * model sends can change it — there is no tool that writes to this object.
 */
const policy: AgentPolicy = {
  ...DEFAULT_POLICY,
  budget: num("AGENT_BUDGET", DEFAULT_POLICY.budget),
  maxOrderContracts: num("AGENT_MAX_ORDER", DEFAULT_POLICY.maxOrderContracts),
  maxTrades: num("AGENT_MAX_TRADES", DEFAULT_POLICY.maxTrades),
  cooldownMs: num("AGENT_COOLDOWN_MS", DEFAULT_POLICY.cooldownMs),
  ttlMs: num("AGENT_TTL_MS", DEFAULT_POLICY.ttlMs),
  allowedMarketIds: (process.env.AGENT_MARKETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  allowedOutcomes: ["YES", "NO"],
  // Fail safe, exactly like PRISM_DRY_RUN: only an explicit "false" arms it.
  dryRun: (process.env.AGENT_DRY_RUN ?? "true") !== "false" || config.dryRun,
};

let state = newState();

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const server = new McpServer({ name: "prism", version: "1.0.0" });

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

server.tool(
  "get_policy",
  "The budget, caps and scope this session trades under, and what remains of them.",
  {},
  async () => ok(describePolicy(policy, state)),
);

server.tool(
  "list_markets",
  "Live Event Contracts from the Somnia registry. Only routable ones can be traded.",
  { routableOnly: z.boolean().default(true) },
  async ({ routableOnly }) => {
    const snap = await getMarketSnapshot(config);
    const rows = (routableOnly ? snap.routable : snap.active).slice(0, 40).map((m) => ({
      marketId: m.marketId,
      symbol: m.symbol,
      asset: m.asset,
      interval: m.interval,
      strike: m.strike,
      secondsToExpiry: m.expiry - Math.floor(Date.now() / 1000),
      headroomSec: headroomSec(m.intervalSec),
      routable: isRoutable(m),
      // Say plainly whether the agent is even permitted to touch it, rather
      // than letting it discover the allowlist by being refused.
      allowedByPolicy: policy.allowedMarketIds.includes(m.marketId),
    }));
    return ok({
      count: rows.length,
      totalInRegistry: snap.all.length,
      venues: Object.keys(snap.venues).length,
      markets: rows,
    });
  },
);

server.tool(
  "get_order_book",
  "Resting depth for one outcome. Books on this venue are frequently one-sided.",
  { marketId: z.string(), outcome: z.enum(["YES", "NO"]) },
  async ({ marketId, outcome }) => {
    const snap = await getMarketSnapshot(config);
    const m = snap.all.find((x) => x.marketId === marketId);
    if (!m) return ok({ error: "MARKET_NOT_FOUND" });
    try {
      const ob = await exchange(config).fetchOrderBook(`${m.symbol}#${outcome}`);
      const asks = (ob.asks ?? []) as [number, number][];
      const bids = (ob.bids ?? []) as [number, number][];
      return ok({
        marketId,
        outcome,
        bestAsk: asks[0]?.[0] ?? null,
        bestBid: bids[0]?.[0] ?? null,
        askDepth: asks.reduce((n, [, s]) => n + s, 0),
        asks: asks.slice(0, 5),
        bids: bids.slice(0, 5),
      });
    } catch (e) {
      return ok({ error: "BOOK_UNREADABLE", detail: String(e).slice(0, 160) });
    }
  },
);

server.tool(
  "get_claimable",
  "Settled positions this wallet can still redeem, with a fee-aware payout estimate.",
  { scan: z.number().int().min(1).max(50).default(25) },
  async ({ scan }) => ok({ claimable: await findClaimable(scan, config) }),
);

server.tool(
  "plan_roll",
  "Whether a view can be carried into the successor window, and at what cost.",
  { marketId: z.string(), outcome: z.enum(["YES", "NO"]), size: z.number().positive() },
  async ({ marketId, outcome, size }) =>
    ok(await planRoll({ marketId, outcome: outcome as Outcome, size }, config)),
);

/* ------------------------------------------------------------------ */
/* Write — the only tool that can spend                                */
/* ------------------------------------------------------------------ */

server.tool(
  "place_order",
  "Buy one outcome. Refused unless the session policy allows it; every outcome is verified from chain.",
  {
    marketId: z.string(),
    outcome: z.enum(["YES", "NO"]),
    size: z.number().positive(),
  },
  async ({ marketId, outcome, size }) => {
    const snap = await getMarketSnapshot(config);
    const market = snap.all.find((m) => m.marketId === marketId) ?? null;
    if (!market) return ok({ status: "REFUSED", reason: "MARKET_NOT_FOUND" });

    // Price against the real book, so the policy decides on the cost the order
    // would actually incur rather than one the model proposed.
    let price: number | null = null;
    try {
      const obj = await exchange(config).fetchOrderBook(`${market.symbol}#${outcome}`);
      price = ((obj.asks ?? []) as [number, number][])[0]?.[0] ?? null;
    } catch {
      price = null;
    }
    if (price === null)
      return ok({ status: "REFUSED", reason: "NO_BOOK_LIQUIDITY", detail: "Nothing is resting on this outcome." });

    const auth = authorize(policy, state, { marketId, outcome, size, price });
    if (!auth.allowed)
      return ok({
        status: "REFUSED_BY_POLICY",
        reason: auth.reason,
        detail: auth.detail,
        policy: describePolicy(policy, state),
      });

    // The venue's own gates still apply, unchanged from the UI path.
    const book = { bids: [] as [number, number][], asks: [[price, size]] as [number, number][] };
    const v = await validateOrder({ marketId, outcome: outcome as Outcome, side: "buy", amount: size }, market, book, config);
    if (!v.ok) return ok({ status: "REFUSED_BY_VENUE", reason: v.reason, detail: v.detail });

    const before = await preflightSnapshot(config);
    const submitted = await submitOrder(v, "buy", config);
    const verdict = await verifyExecution(submitted, before, config);

    // Charge what FILLED, not what was authorized — an IOC can fill partially.
    const filled = submitted.filled ?? 0;
    state = commit(state, filled * v.price);

    return ok({
      status: verdict.status,
      marketId,
      outcome,
      requested: size,
      filled,
      price: v.price,
      txHash: "transactionHash" in verdict ? verdict.transactionHash : null,
      explorer:
        "transactionHash" in verdict && verdict.transactionHash
          ? explorerTx(verdict.transactionHash, config)
          : null,
      evidence: verdict.evidence,
      policy: describePolicy(policy, state),
    });
  },
);

/* ---- parity reads: everything the terminal shows ---- */

server.tool(
  "get_balances",
  "Collateral and gas on the signing wallet, read straight off chain.",
  {},
  async () => ok((await readBalances(config)) ?? { error: "NO_SIGNER" }),
);

server.tool(
  "get_prices",
  "Somnia's on-chain EMA oracle: the feed these contracts settle against.",
  {
    asset: z.string().default("BTC"),
    timeframe: z.enum(["1m", "1h", "1d"]).default("1m"),
    limit: z.number().int().min(1).max(500).default(120),
  },
  async ({ asset, timeframe, limit }) => {
    const p = await getPriceSnapshot(asset, timeframe, limit).catch(() => null);
    if (!p) return ok({ error: "NO_ORACLE_FEED", asset });
    return ok({ asset, live: p.live, candles: p.candles.slice(-limit) });
  },
);

server.tool(
  "get_structures",
  "Which structures this venue can express, decided from the live registry.",
  {},
  async () => {
    const snap = await getMarketSnapshot(config);
    return ok({ matrix: structureMatrix(snap.all), marketsRead: snap.all.length });
  },
);

server.tool(
  "get_open_orders",
  "Orders still resting on a market, re-read from chain rather than the indexer.",
  { marketId: z.string() },
  async ({ marketId }) => ok({ resting: await restingOrders(marketId, config) }),
);

server.tool(
  "get_history",
  "Transactions this signer has sent, from the Shannon explorer account API.",
  { limit: z.number().int().min(1).max(100).default(25) },
  async ({ limit }) => {
    const bal = await readBalances(config);
    if (!bal) return ok({ error: "NO_SIGNER" });
    return ok(await getHistory(bal.address, limit, config).catch((e) => ({ error: String(e).slice(0, 160) })));
  },
);

server.tool(
  "verify_proof",
  "Re-read the recorded lifecycle transactions from chain. Nothing is cached.",
  {},
  async () => ok(await verifyLifecycle(config)),
);

server.tool(
  "plan_batch",
  "Price and gate a multi-leg structure WITHOUT signing anything.",
  {
    legs: z
      .array(
        z.object({
          marketId: z.string(),
          outcome: z.enum(["YES", "NO"]),
          size: z.number().positive(),
        }),
      )
      .min(2)
      .max(4),
  },
  async ({ legs }) =>
    ok(await planBatch(legs.map((l) => ({ ...l, side: "buy" as const })) as BatchLeg[], config)),
);

/* ---- parity writes: each one asks the policy first ---- */

server.tool(
  "execute_batch",
  "Open a multi-leg structure. Not atomic on this chain — read the atomicity field.",
  {
    legs: z
      .array(
        z.object({
          marketId: z.string(),
          outcome: z.enum(["YES", "NO"]),
          size: z.number().positive(),
        }),
      )
      .min(2)
      .max(4),
  },
  async ({ legs }) => {
    // Every leg is authorized separately against the SAME budget, so a batch
    // cannot do in four calls what one call would be refused for.
    const plans = await planBatch(legs.map((l) => ({ ...l, side: "buy" as const })) as BatchLeg[], config);
    let projected = state;
    for (const p of plans) {
      const price = p.price ?? 0.5;
      const a = authorize(policy, projected, {
        marketId: p.leg.marketId,
        outcome: p.leg.outcome,
        size: p.leg.size,
        price,
      });
      if (!a.allowed)
        return ok({
          status: "REFUSED_BY_POLICY",
          leg: p.leg.label ?? p.leg.marketId,
          reason: a.reason,
          detail: a.detail,
          policy: describePolicy(policy, state),
        });
      projected = commit(projected, p.leg.size * price);
    }

    const r = await executeBatch(legs.map((l) => ({ ...l, side: "buy" as const })) as BatchLeg[], config);
    for (const o of r.outcomes)
      if (o.status === "FILLED") state = commit(state, o.filled * 0.5);
    return ok({ ...r, policy: describePolicy(policy, state) });
  },
);

server.tool(
  "execute_roll",
  "Carry a view into the successor window. Opens the successor; the expiring leg settles.",
  { marketId: z.string(), outcome: z.enum(["YES", "NO"]), size: z.number().positive() },
  async ({ marketId, outcome, size }) => {
    const plan = await planRoll({ marketId, outcome: outcome as Outcome, size }, config);
    if (!plan.ok || !plan.to)
      return ok({ status: "NOT_ATTEMPTED", blocker: plan.blocker, detail: plan.detail });

    const a = authorize(policy, state, {
      marketId: plan.to.marketId,
      outcome: outcome as Outcome,
      size,
      price: plan.price ?? 0.5,
    });
    if (!a.allowed)
      return ok({
        status: "REFUSED_BY_POLICY",
        reason: a.reason,
        detail: a.detail,
        policy: describePolicy(policy, state),
      });

    const r = await executeRoll({ marketId, outcome: outcome as Outcome, size }, config);
    state = commit(state, r.filled * (plan.price ?? 0));
    return ok({ ...r, policy: describePolicy(policy, state) });
  },
);

server.tool(
  "claim_settlement",
  "Redeem a settled position. Collects funds rather than spending them, so it costs no budget.",
  { marketId: z.string() },
  async ({ marketId }) => {
    if (state.revoked) return ok({ status: "REFUSED_BY_POLICY", reason: "SESSION_REVOKED" });
    if (policy.dryRun) return ok({ status: "REFUSED_BY_POLICY", reason: "DRY_RUN" });
    const rows = await findClaimable(25, config);
    const row = rows.find((r) => r.marketId === marketId);
    if (!row) return ok({ status: "NOTHING_TO_CLAIM", marketId });
    return ok(await claim(row, config));
  },
);

server.tool(
  "cancel_orders",
  "Pull resting orders. Spends no budget; what is still resting is re-read from chain.",
  { marketId: z.string(), orderIds: z.array(z.string()).min(1) },
  async ({ marketId, orderIds }) => {
    if (state.revoked) return ok({ status: "REFUSED_BY_POLICY", reason: "SESSION_REVOKED" });
    return ok(await cancelOrders(marketId, orderIds, config));
  },
);

server.tool(
  "flatten_market",
  "Pull EVERY resting order on a market. The safe exit; costs no budget.",
  { marketId: z.string() },
  async ({ marketId }) => {
    if (state.revoked) return ok({ status: "REFUSED_BY_POLICY", reason: "SESSION_REVOKED" });
    return ok(await flatten(marketId, config));
  },
);

server.tool(
  "revoke_session",
  "Stop this session from spending anything further. One-way and immediate.",
  {},
  async () => {
    state = revoke(state);
    return ok({ revoked: true, policy: describePolicy(policy, state) });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
