/**
 * Can PRISM REST a bid on a window nobody is offering?
 *
 * The whole taker path dies on an empty book: an IOC order must cross a resting
 * offer, and when there is none the terminal can only tell the reader to wait.
 * A post-only order is the opposite side of that trade — it ADDS liquidity
 * instead of taking it, so it does not need anybody to be quoting first.
 *
 * This probes it for real, at the smallest size the grid allows, and then pulls
 * the order back. Nothing is claimed that is not printed below.
 */
import { placeLimit } from "../sdk/dreamdex/place-limit";
import { restingOrders, cancelOrders } from "../sdk/dreamdex/cancel";
import { getMarketSnapshot, exchange } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";
import { isRoutable } from "../sdk/venue/types";

const config = resolveVenueConfig();
const snap = await getMarketSnapshot(config);
const ex = exchange(config);
const live = snap.routable.filter((m) => isRoutable(m, Date.now()));

if (!live.length) {
  console.log("nothing routable — cannot probe");
  process.exit(0);
}

// TIME LEFT COMES FIRST. The first attempt picked "any leg with no resting
// offer", which is strongly correlated with a window that is about to close —
// and the venue answered OrderAlreadyExpired(), a verdict about the MARKET, not
// about post-only. So candidates are ordered by how long they have left, and a
// window with under two minutes is not probed at all.
const durable = live
  .filter((m) => m.expiry - Math.floor(Date.now() / 1000) > 120)
  .sort((a, b) => b.expiry - a.expiry);

if (!durable.length) {
  console.log("every routable window has under 120s left — not probing into a close");
  process.exit(0);
}

const target = durable[0];
console.log(`candidates ${durable.length} (of ${live.length} routable)`);

console.log(`market ${target.symbol}`);
console.log(`expiry in ${target.expiry - Math.floor(Date.now() / 1000)}s\n`);

// A deliberately far-from-market bid so it RESTS rather than crossing anything.
const PRICE = 0.02;
const SIZE = 1;

console.log(`placing post-only BUY YES ${SIZE} @ ${PRICE} ...`);
const res = await placeLimit(
  { marketId: target.marketId, outcome: "YES", side: "buy", price: PRICE, size: SIZE, type: "post-only" },
  config,
);
console.log(JSON.stringify(res, null, 2));

if (!res.hash) {
  console.log("\nno transaction — post-only did not place");
  process.exit(1);
}

const resting = await restingOrders(target.marketId, config);
console.log(`\nchain reports ${resting.length} resting order(s) on this market`);
console.log(resting.map((o) => `  ${o.orderId}`).join("\n"));

if (resting.length) {
  console.log("\ncancelling ...");
  const c = await cancelOrders(target.marketId, resting.map((o) => o.orderId), config);
  console.log(JSON.stringify(c, null, 2));
}
process.exit(0);
