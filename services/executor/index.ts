/**
 * PRISM Executor — the single-writer signing service.
 *
 * THIS SERVICE EXISTS FOR A HARD REASON, not for architectural fashion.
 *
 * Every transaction from one key consumes a sequential nonce. Two concurrent
 * senders on one key race, and the loser dies with "nonce too low". The web app
 * runs on serverless: many instances, no shared memory, no way to coordinate.
 * So in-process signing is CORRECT ONLY at one instance and silently broken at
 * two — which is exactly the failure that appears under load and never in dev.
 *
 * The fix is to make signing single-writer by construction. One executor, one
 * key, one queue, strictly serialized. Everything else can scale horizontally
 * because nothing else holds a nonce.
 *
 * The queue is the product of this service. Rejecting work when it is too deep
 * is a feature: a caller told "queue full, retry" can back off, whereas one
 * left waiting behind 400 orders has already timed out.
 */

import { serve } from "bun";
import {
  validateOrder,
  submitOrder,
  verifyExecution,
  preflightSnapshot,
  explorerTx,
  type OrderSide,
} from "../../sdk/dreamdex/execution";
import { exchange } from "../../sdk/venue/markets";
import { getMarketSnapshot } from "../../sdk/venue/markets";
import { resolveVenueConfig } from "../../sdk/venue/config";
import { emit, snapshot, tracked } from "../../sdk/observability";
import type { Outcome } from "../../sdk/venue/types";

const PORT = Number(process.env.EXECUTOR_PORT ?? 8081);
/** Shared secret so only the web app can reach the key. */
const TOKEN = process.env.EXECUTOR_TOKEN ?? "";
/** Refuse rather than let a caller wait behind a queue it will outlive. */
const MAX_QUEUE = Number(process.env.EXECUTOR_MAX_QUEUE ?? 25);

interface Job {
  marketId: string;
  outcome: Outcome;
  side: OrderSide;
  amount: number;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const queue: Job[] = [];
let draining = false;

/**
 * Drain strictly one at a time.
 *
 * The `draining` flag is the whole guarantee: no two jobs can be in flight, so
 * no two transactions can contend for the same nonce.
 */
async function drain() {
  if (draining) return;
  draining = true;

  while (queue.length) {
    const job = queue.shift()!;
    try {
      job.resolve(await execute(job));
    } catch (e) {
      job.reject(e);
    }
  }

  draining = false;
}

async function execute(job: Job) {
  const config = resolveVenueConfig();
  const started = Date.now();

  const snap = await getMarketSnapshot(config);
  const market = snap.all.find((m) => m.marketId === job.marketId) ?? null;

  let book: { bids: [number, number][]; asks: [number, number][] } | null = null;
  if (market) {
    try {
      const ob = await exchange(config).fetchOrderBook(`${market.symbol}#${job.outcome}`);
      book = {
        bids: (ob.bids ?? []) as [number, number][],
        asks: (ob.asks ?? []) as [number, number][],
      };
    } catch {
      book = null;
    }
  }

  const v = await validateOrder(
    { marketId: job.marketId, outcome: job.outcome, side: job.side, amount: job.amount },
    market,
    book,
    config,
  );

  if (!v.ok) {
    return {
      phase: "VALIDATION_FAILED",
      validation: { reason: v.reason, detail: v.detail },
      elapsedMs: Date.now() - started,
    };
  }

  const before = await preflightSnapshot(config);
  const submitted = await submitOrder(v, job.side, config);
  const verification = await verifyExecution(submitted, before, config);

  const hash =
    "transactionHash" in verification ? verification.transactionHash : null;

  return {
    phase: "SUBMITTED",
    verification,
    explorerUrl: hash ? explorerTx(hash, config) : null,
    ref: v.ref,
    price: v.price,
    amount: v.amount,
    estimatedCost: v.estimatedCost,
    elapsedMs: Date.now() - started,
  };
}

function enqueue(job: Omit<Job, "resolve" | "reject">) {
  return new Promise((resolve, reject) => {
    if (queue.length >= MAX_QUEUE) {
      reject(new Error(`queue full (${queue.length}) — retry shortly`));
      return;
    }
    queue.push({ ...job, resolve, reject });
    void drain();
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Liveness for the orchestrator, plus the metrics a human needs at 3am.
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "executor",
        queueDepth: queue.length,
        draining,
        maxQueue: MAX_QUEUE,
        ...snapshot(),
      });
    }

    if (url.pathname === "/execute" && req.method === "POST") {
      if (TOKEN && req.headers.get("authorization") !== `Bearer ${TOKEN}`)
        return json({ error: "unauthorized" }, 401);

      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid json" }, 400);
      }

      const marketId = String(body.marketId ?? "");
      const outcome = body.outcome === "NO" ? "NO" : "YES";
      const amount = Number(body.amount ?? 0);
      if (!marketId || !(amount > 0)) return json({ error: "marketId and amount required" }, 400);

      try {
        const result = await tracked("executor.execute", () =>
          enqueue({ marketId, outcome, side: "buy", amount }),
        );
        return json(result);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 503);
      }
    }

    return json({ error: "not found" }, 404);
  },
});

emit({
  level: "info",
  op: "executor.start",
  meta: { port: PORT, maxQueue: MAX_QUEUE, authRequired: Boolean(TOKEN) },
});
console.log(`executor listening on :${PORT} (single-writer, max queue ${MAX_QUEUE})`);
