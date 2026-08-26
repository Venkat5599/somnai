import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const j = (o:unknown,n=1600)=>JSON.stringify(o,(_k,v)=>typeof v==="bigint"?v.toString():v,2).slice(0,n);
const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
await ex.loadMarkets(true);
try {
  const pos = await ex.fetchPositions();
  console.log(`### fetchPositions -> ${pos.length} rows`);
  console.log(j(pos, 2000));
} catch (e:any) { console.log("fetchPositions failed:", String(e?.message).slice(0,250)); }
try {
  const t = await ex.fetchMyTrades(undefined, undefined, 5);
  console.log(`\n### fetchMyTrades -> ${t.length}`);
  console.log(j(t, 1200));
} catch (e:any) { console.log("fetchMyTrades failed:", String(e?.message).slice(0,250)); }
