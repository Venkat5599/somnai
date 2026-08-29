/**
 * Prove the wallet path can BUILD a transaction, without signing one.
 *
 * This is the path that failed with "createTrader is authenticated". It is
 * exercised here against the live venue because it was fixed and then routed
 * around before anyone ran it — a fix nobody has executed is a claim.
 */
import { getMarketSnapshot } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";
import { prepareOrder } from "../sdk/dreamdex/prepare";

const config = resolveVenueConfig();
const snap = await getMarketSnapshot(config);
const m = snap.routable[0] ?? snap.all.find((x) => x.strike !== null && x.active) ?? null;
if (!m) {
  console.log("No market to build against right now.");
  process.exit(0);
}

// A real address, so the owner-specific approval encodes correctly. Never a key.
const owner = "0xBfc9000000000000000000000000000000000690";
console.log(`market ${m.symbol}`);
console.log(`owner  ${owner}`);

const r = await prepareOrder(
  { marketId: m.marketId, outcome: "YES", side: "buy", amount: 1, owner },
  m,
  config,
);

if (!r.ok) {
  console.log(`\nBUILD REFUSED  ${r.reason}: ${r.detail}`);
  process.exit(r.reason === "BUILD_FAILED" ? 1 : 0);
}
console.log("\nBUILT — a wallet could sign this:");
console.log(`  approval  ${r.approval ? r.approval.to : "(none needed)"}`);
console.log(`  order to  ${r.order.to}`);
console.log(`  data      ${r.order.data.slice(0, 42)}…  (${r.order.data.length} chars)`);
console.log(`  quote     ${r.quote.size} @ ${r.quote.price} = ${r.quote.cost.toFixed(6)}`);
process.exit(0);
