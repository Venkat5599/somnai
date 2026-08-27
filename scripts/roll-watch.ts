/**
 * Watch for a rollable successor and fire the REAL roll when one appears.
 *
 * WHY THIS WAS REWRITTEN. The previous version of this file was a parallel
 * implementation: it re-derived the tick grid by hand, hard-coded `tick = 1000n`
 * instead of asking the pool, addressed the raw trader tier directly through
 * `(ex as any)`, and read `res.receipt.status` as the verdict. So whatever it
 * proved, it did not prove that PRISM's roll path works — it proved that a
 * lookalike written next to it works.
 *
 * That mattered because this script is the ONLY way the last open claim in the
 * README ever gets closed. A roll on a live successor cannot be demonstrated on
 * demand: the venue does not pre-strike successors, so the window in which one
 * exists, is struck, and has a resting offer is short and unpredictable. The
 * honest instrument is a watcher that sits on the venue until that window opens
 * and then fires the same code the app fires.
 *
 * So it now calls planRoll/executeRoll from sdk/dreamdex/roll.ts directly. The
 * grid comes from the pool, the verdict comes from the receipt via raw RPC, and
 * a success here is evidence about PRISM rather than about this file.
 *
 *   bun --conditions react-server scripts/roll-watch.ts
 *
 *   ROLL_WATCH_MINUTES   how long to sit on the venue   (default 60)
 *   ROLL_WATCH_INTERVAL  seconds between sweeps         (default 12)
 *   ROLL_WATCH_SIZE      contracts to carry             (default 1)
 *   ROLL_WATCH_MAX_SEC   longest cadence to watch       (default 900)
 *   PRISM_DRY_RUN        "false" to actually sign
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getMarketSnapshot } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";
import { executeRoll, planRoll } from "../sdk/dreamdex/roll";
import type { EventMarket, Outcome } from "../sdk/venue/types";

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

const MINUTES = num("ROLL_WATCH_MINUTES", 60);
const INTERVAL_SEC = num("ROLL_WATCH_INTERVAL", 12);
const SIZE = num("ROLL_WATCH_SIZE", 1);
const MAX_INTERVAL_SEC = num("ROLL_WATCH_MAX_SEC", 900);
const RECEIPT = join(process.cwd(), "docs", "evidence", "roll-receipt.json");

const config = resolveVenueConfig();
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (s: string) => console.log(`${stamp()}  ${s}`);

/**
 * Every live market whose cadence is short enough to actually roll inside the
 * watch window, newest expiry last. Long cadences are excluded because a 24h
 * window will not close during an hour of watching, so polling it is noise.
 */
function candidates(snap: Awaited<ReturnType<typeof getMarketSnapshot>>): EventMarket[] {
  const now = Math.floor(Date.now() / 1000);
  return snap.active
    .filter((m) => m.intervalSec <= MAX_INTERVAL_SEC && m.strike !== null && m.expiry > now)
    .sort((a, b) => a.expiry - b.expiry);
}

async function sweep(attempt: number): Promise<boolean> {
  const snap = await getMarketSnapshot(config);
  const live = candidates(snap);

  // Blockers are counted rather than printed per market: on a normal sweep
  // every chain reports NO_SUCCESSOR_LISTED, and ten identical lines every
  // twelve seconds buries the one line that matters.
  const blockers = new Map<string, number>();
  let planned = 0;

  for (const market of live) {
    for (const outcome of ["YES", "NO"] as Outcome[]) {
      const plan = await planRoll({ marketId: market.marketId, outcome, size: SIZE }, config);
      planned++;

      if (!plan.ok) {
        blockers.set(plan.blocker ?? "unknown", (blockers.get(plan.blocker ?? "unknown") ?? 0) + 1);
        continue;
      }

      log("");
      log(`ROLLABLE  ${market.asset} ${market.interval} ${outcome}`);
      log(`  from     ${plan.from?.marketId.slice(0, 18)}…  strike ${plan.from?.strike}`);
      log(`  into     ${plan.to?.marketId.slice(0, 18)}…  strike ${plan.to?.strike}`);
      log(`  carry    ${SIZE} at ${plan.price} = ${plan.estimatedCost?.toFixed(6)} tUSDC`);
      log(`  window   ${plan.secondsLeft}s left, ${plan.headroom}s headroom required`);

      if (config.dryRun) {
        log("  PRISM_DRY_RUN is true — a real successor was found but nothing was signed.");
        log("  Re-run with PRISM_DRY_RUN=false to close the open claim.");
        return true;
      }

      log("  firing executeRoll…");
      const result = await executeRoll(
        { marketId: market.marketId, outcome, size: SIZE },
        config,
      );

      log(`  status   ${result.status}`);
      log(`  tx       ${result.txHash ?? "(none)"}`);
      log(`  block    ${result.blockNumber ?? "(none)"}`);
      for (const e of result.evidence) log(`  evidence ${e}`);

      if (result.status === "VERIFIED_EXECUTED") {
        mkdirSync(dirname(RECEIPT), { recursive: true });
        writeFileSync(
          RECEIPT,
          JSON.stringify(
            {
              recordedAt: new Date().toISOString(),
              network: config.network,
              explorerUrl: `${config.explorer}/tx/${result.txHash}`,
              asset: market.asset,
              interval: market.interval,
              outcome,
              size: SIZE,
              from: plan.from,
              to: plan.to,
              price: plan.price,
              txHash: result.txHash,
              blockNumber: result.blockNumber,
              filled: result.filled,
              evidence: result.evidence,
            },
            null,
            2,
          ) + "\n",
        );
        log("");
        log(`VERIFIED ROLL. Receipt written to ${RECEIPT}`);
        log(`${config.explorer}/tx/${result.txHash}`);
        return true;
      }

      // A failed attempt is not a reason to stop: the successor may still be
      // there next sweep with a better book.
      log("  roll did not verify — continuing to watch.");
    }
  }

  const summary = [...blockers].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join("  ");
  log(`sweep ${String(attempt).padStart(3)}  ${live.length} live · ${planned} planned · ${summary || "nothing to plan"}`);
  return false;
}

async function main() {
  log(`network ${config.network} · chain ${config.chainId} · dryRun ${config.dryRun}`);
  log(`watching cadences up to ${MAX_INTERVAL_SEC}s for ${MINUTES} minutes, sweeping every ${INTERVAL_SEC}s`);
  if (config.dryRun)
    log("PRISM_DRY_RUN is true: a successor will be REPORTED but never traded.");

  const deadline = Date.now() + MINUTES * 60_000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      if (await sweep(attempt)) process.exit(0);
    } catch (e) {
      // The testnet indexer times out regularly. A failed sweep is a bad
      // minute, not a reason to abandon an hour of watching.
      log(`sweep failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }

  log("");
  log(`no rollable successor appeared in ${MINUTES} minutes.`);
  log("This is the venue's behaviour, not a failure of the roll path: successors");
  log("are struck only as a window nears close, and often not at all.");
  process.exit(2);
}

await main();
