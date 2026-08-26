/** Phase 0: read-only reconnaissance of the execution path. Places NO order. */
import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const pk = process.env.PRIVATE_KEY;
if (!pk) { console.error("PRIVATE_KEY missing from env"); process.exit(1); }

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  privateKey: pk as `0x${string}`,
});

const all = Object.values(await ex.loadMarkets(true));
const live = all.filter((m: any) => m.type === "binary" && m.active && m.info?.strike && m.info.strike !== "0");
console.log(`routable-ish binary markets: ${live.length}`);

const m: any = live[0];
if (!m) { console.log("NO STRUCK MARKET RIGHT NOW"); process.exit(0); }

console.log("\n### TARGET MARKET");
console.log("  symbol   :", m.symbol);
console.log("  marketId :", m.info.marketId);
console.log("  asset    :", m.info.asset, m.info.interval);
console.log("  strike   :", Number(m.info.strike) / 100);
console.log("  expiry   :", new Date(Number(m.info.expiry) * 1000).toISOString());
console.log("  minAmount:", m.limits?.amount?.min, " pricePrec:", m.precision?.price);
console.log("  outcomes :", JSON.stringify(m.outcomes));

console.log("\n### BALANCES");
try {
  const b = await ex.fetchBalance();
  console.log(JSON.stringify(b, (_k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 600));
} catch (e: any) { console.log("  fetchBalance failed:", String(e?.message).slice(0, 200)); }

console.log("\n### ORDER BOOK (YES outcome)");
const yes = m.outcomes?.[0]?.symbol;
console.log("  ref:", yes);
try {
  const ob = await ex.fetchOrderBook(yes);
  console.log("  bids:", JSON.stringify(ob.bids?.slice(0, 3)));
  console.log("  asks:", JSON.stringify(ob.asks?.slice(0, 3)));
} catch (e: any) { console.log("  fetchOrderBook failed:", String(e?.message).slice(0, 220)); }

console.log("\n### OPEN ORDERS");
try { console.log("  ", JSON.stringify(await ex.fetchOpenOrders()).slice(0, 300)); }
catch (e: any) { console.log("  fetchOpenOrders failed:", String(e?.message).slice(0, 200)); }
