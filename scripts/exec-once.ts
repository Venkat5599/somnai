/**
 * ONE real order. Smallest meaningful size, crossing the best ask.
 * Prints raw truth — no interpretation, no success assumption.
 */
import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const pk = process.env.PRIVATE_KEY!;
const j = (o: unknown, n = 1400) =>
  JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, n);

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  privateKey: pk as `0x${string}`,
});

const all = Object.values(await ex.loadMarkets(true));
const m: any = all.find(
  (x: any) => x.type === "binary" && x.active && x.info?.strike && x.info.strike !== "0",
);
if (!m) { console.log("NO STRUCK MARKET"); process.exit(0); }

const ref = m.outcomes[0].symbol;
const left = Number(m.info.expiry) - Math.floor(Date.now() / 1000);
console.log(`market ${m.symbol}`);
console.log(`ref    ${ref}`);
console.log(`expiry in ${left}s`);

const ob = await ex.fetchOrderBook(ref);
const bestAsk = ob.asks?.[0]?.[0];
console.log(`best ask ${bestAsk}`);
if (!bestAsk) { console.log("NO ASK — cannot cross"); process.exit(0); }

const AMOUNT = 1;
console.log(`\n>>> BUY ${AMOUNT} @ ${bestAsk}  (cost ~${(AMOUNT * bestAsk).toFixed(4)} tUSDC)`);

try {
  const order = await ex.createOrder(ref, "limit", "buy", AMOUNT, bestAsk, { timeInForce: "IOC" });
  console.log("\n### RAW UnifiedOrder RETURNED:");
  console.log(j(order, 2000));
  console.log("\n### KEY FIELDS");
  console.log("  id      :", order.id);
  console.log("  status  :", order.status);
  console.log("  txHash  :", order.txHash ?? "(none on order)");
  console.log("  filled  :", order.filled, "remaining:", order.remaining);
} catch (e: any) {
  console.log("\n### createOrder THREW:");
  console.log("  ", String(e?.message ?? e).slice(0, 600));
}
