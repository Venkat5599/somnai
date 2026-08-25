import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
});

console.log("feed:", JSON.stringify(SOMNIA_TESTNET_PRICE_FEED));

for (const a of ["BTC", "ETH"]) {
  const p = await ex.fetchPrice(a);
  console.log(`\n### ${a} live price:`, JSON.stringify(p));
}

const m = Object.getOwnPropertyNames(Object.getPrototypeOf(ex)).filter(n => /candle|ohlc|price/i.test(n));
console.log("\n### candle-ish methods:", m.join(", "));

for (const name of m) {
  if (!/candle|ohlc/i.test(name)) continue;
  try {
    const rows = await ex[name]("BTC", "1m", undefined, 5);
    console.log(`\n### ${name}("BTC","1m") -> ${rows?.length} rows`);
    console.log(JSON.stringify(rows?.slice(0, 3)));
  } catch (e) { console.log(`  ${name} failed: ${String(e?.message).slice(0,120)}`); }
}
