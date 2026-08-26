import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const j=(o:unknown,n=900)=>JSON.stringify(o,(_k,v)=>typeof v==="bigint"?v.toString():v,2).slice(0,n);

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
const c: any = (ex as any).client;
const ME = "0x8DaB23C096CD074d1c06521B0D5954618611A6a6";

const p = await c.getPortfolio(ME, { limit: 30 });
console.log("keys:", Object.keys(p).join(", "));
console.log(`\n### trades: ${p.trades?.length ?? 0}`);
for (const t of (p.trades ?? []).slice(0, 3)) console.log("  " + j(t, 400));
console.log(`\n### openOrders: ${p.openOrders?.length ?? 0}`);
for (const o of (p.openOrders ?? []).slice(0, 2)) console.log("  " + j(o, 300));
