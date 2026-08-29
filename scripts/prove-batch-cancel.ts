/**
 * Close the two remaining unproven paths with real transactions.
 *
 * `executeBatch` and `cancelOrders` were fully written and unit-tested and had
 * never sent anything. That is exactly the gap this repository refuses to paper
 * over elsewhere — a library nobody has run is a claim, not a capability — so
 * this drives both against the live venue and re-derives every outcome from
 * chain.
 *
 *   PRISM_DRY_RUN=false bun --conditions react-server scripts/prove-batch-cancel.ts
 *
 * Signs real transactions. Refuses to run unless DRY_RUN is explicitly false,
 * and writes docs/evidence/batch-cancel-receipt.json with whatever actually
 * happened — including a failure, which is evidence too.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMarketSnapshot, exchange } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";
import { executeBatch, type BatchLeg } from "../sdk/dreamdex/batch";
import { placeLimit } from "../sdk/dreamdex/place-limit";
import { cancelOrders, restingOrders } from "../sdk/dreamdex/cancel";
import { readBalances } from "../sdk/dreamdex/execution";

const config = resolveVenueConfig();
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`);

if (config.dryRun) {
  log("PRISM_DRY_RUN is not false. Refusing — this script signs real transactions.");
  process.exit(2);
}

/**
 * Wait for the venue to strike something.
 *
 * Windows are minutes long and the board empties between them, so a single
 * snapshot frequently reports zero routable markets. Reporting "skipped" in
 * that case would record the venue's schedule as if it were a limitation of
 * these paths, which is precisely the confusion the roll evidence exists to
 * avoid. So this waits for a routable board rather than concluding from an
 * empty one.
 */
const WAIT_MIN = Number(process.env.PROVE_WAIT_MINUTES ?? "12");
const deadline = Date.now() + WAIT_MIN * 60_000;
let snap = await getMarketSnapshot(config);
let waited = 0;
while (snap.routable.length === 0 && Date.now() < deadline) {
  waited++;
  if (waited % 4 === 1) log(`waiting for a routable window… (${snap.active.length} active, 0 routable)`);
  await new Promise((r) => setTimeout(r, 15_000));
  snap = await getMarketSnapshot(config);
}

const bal = await readBalances(config);
log(
  `routable ${snap.routable.length} · tUSDC ${bal?.collateral.toFixed(4) ?? "?"} · gas ${bal?.gas.toFixed(4) ?? "?"}`,
);

/* ------------------------------------------------------------------ */
/* 1. Multi-leg batch — only on legs that actually have a resting offer */
/* ------------------------------------------------------------------ */

const ex = exchange(config);
const legsWithBook: { marketId: string; outcome: "YES" | "NO"; symbol: string; ask: number }[] = [];

for (const m of snap.routable) {
  if (legsWithBook.length >= 2) break;
  if (legsWithBook.some((w) => w.marketId === m.marketId)) continue;
  for (const o of ["YES", "NO"] as const) {
    try {
      const ob = await ex.fetchOrderBook(`${m.symbol}#${o}`);
      const ask = ((ob.asks ?? []) as [number, number][])[0]?.[0];
      if (ask) {
        legsWithBook.push({ marketId: m.marketId, outcome: o, symbol: m.symbol, ask });
        break;
      }
    } catch {
      /* an unreadable book is not a leg */
    }
  }
}

let batchResult: unknown = null;

if (legsWithBook.length < 2) {
  log(`only ${legsWithBook.length} leg(s) carry a resting offer — a batch needs 2. Skipped.`);
} else {
  const legs: BatchLeg[] = legsWithBook.map((w) => ({
    marketId: w.marketId,
    outcome: w.outcome,
    side: "buy",
    size: 1,
    label: `${w.symbol}#${w.outcome}`,
  }));

  log(`batch: ${legs.length} legs`);
  for (const w of legsWithBook) log(`  leg ${w.symbol}#${w.outcome} ask ${w.ask}`);

  const r = await executeBatch(legs, config);
  batchResult = r;

  log(`  atomicity  ${r.atomicity}`);
  log(`  cost       ${r.totalCost ?? "-"}  in ${r.elapsedMs}ms`);
  for (const o of r.outcomes)
    log(`  leg ${o.status.padEnd(13)} filled ${o.filled}  tx ${o.txHash ?? "(none)"}`);
  for (const u of r.unwinds) log(`  unwind ${u.status}  ${u.txHash ?? ""}`);
}

/* ------------------------------------------------------------------ */
/* 2. Post-only place, then cancel — resting state re-read from chain  */
/* ------------------------------------------------------------------ */

let cancelProof: unknown = null;
const target = snap.routable[0];

if (!target) {
  log("no routable market for the cancel proof");
} else {
  // Far below any book so it rests rather than crossing. The point is to have
  // something real to pull, not to trade.
  const restPrice = 0.05;
  log(`post-only ${target.symbol}#YES @ ${restPrice}`);

  const placed = await placeLimit(
    { marketId: target.marketId, outcome: "YES", side: "buy", price: restPrice, size: 1, type: "post-only" },
    config,
  );
  log(`  orderId ${placed.orderId ?? "(none)"}  tx ${placed.hash ?? "(none)"}  rested ${placed.rested}`);

  if (placed.orderId) {
    const before = await restingOrders(target.marketId, config);
    log(`  resting before cancel: ${before.length}`);

    const c = await cancelOrders(target.marketId, [placed.orderId], config);
    log(`  cancel ${c.status}  tx ${c.txHash ?? "(none)"}  block ${c.blockNumber ?? "-"}`);
    for (const e of c.evidence) log(`    ${e}`);

    // The whole point of the cancel module: what is STILL resting comes from
    // chain, not from a green receipt. A batch cancel skips stale ids silently.
    const after = await restingOrders(target.marketId, config);
    log(`  resting after cancel:  ${after.length}  (re-read from chain)`);

    cancelProof = {
      placed,
      cancel: c,
      restingBefore: before.length,
      restingAfter: after.length,
    };
  } else {
    log("  venue returned no order id — nothing to cancel, so nothing is claimed");
  }
}

const dir = join(process.cwd(), "docs", "evidence");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "batch-cancel-receipt.json"),
  JSON.stringify(
    { recordedAt: new Date().toISOString(), network: config.network, batch: batchResult, cancel: cancelProof },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
log("receipt written to docs/evidence/batch-cancel-receipt.json");
process.exit(0);
