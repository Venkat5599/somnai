import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const j=(o:unknown,n=900)=>JSON.stringify(o,(_k,v)=>typeof v==="bigint"?v.toString():v,2).slice(0,n);

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
const c: any = (ex as any).client;
const ME = "0x8DaB23C096CD074d1c06521B0D5954618611A6a6";

const p = await c.getPortfolio(ME, { limit: 20 });
console.log(`### positions: ${p.positions.length}`);
for (const pos of p.positions) {
  const m = pos.market ?? {};
  console.log("\n--- position ---");
  console.log("  outcomeIndex :", pos.outcomeIndex);
  console.log("  balance      :", pos.balance, `(= ${Number(pos.balance)/1e6} contracts)`);
  console.log("  marketId     :", m.id);
  console.log("  symbol       :", m.symbol ?? "(none)");
  console.log("  status       :", m.status, "finalized:", m.finalized);
  console.log("  winningOutcome:", m.winningOutcome);
  const won = m.winningOutcome !== null && Number(m.winningOutcome) === Number(pos.outcomeIndex);
  console.log("  >>> REDEEMABLE:", m.finalized && won ? "YES — winning side" : (m.finalized ? "no — losing side" : "not finalized yet"));
}
