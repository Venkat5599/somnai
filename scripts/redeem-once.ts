import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const j=(o:unknown,n=1200)=>JSON.stringify(o,(_k,v)=>typeof v==="bigint"?v.toString():v,2).slice(0,n);

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
const ID = "0x0000000000000000000000000000000000000000000000000000000000009c7a";

const oc = await c.getMarketOnchain(ID);
console.log("### ON-CHAIN TRUTH for 0x…9c7a");
console.log("  isResolved:", oc.isResolved, "| isVoided:", oc.isVoided, "| finalized:", oc.finalized);
console.log("  winningOutcome:", oc.winningOutcome, "| decimals:", oc.decimals);
console.log("  outcomeToken:", oc.outcomeToken);

const [yes, no] = await Promise.all([
  c.getOutcomeBalance({ outcomeToken: oc.outcomeToken, account: ME, id: oc.yesId }),
  c.getOutcomeBalance({ outcomeToken: oc.outcomeToken, account: ME, id: oc.noId }),
]);
console.log(`  held: yes=${yes} no=${no}`);

const dec = Number(oc.decimals ?? 6);
const idxs: number[] = oc.isVoided ? [0, 1] : [Number(oc.winningOutcome)];
for (const idx of idxs) {
  const held = idx === 0 ? BigInt(yes) : BigInt(no);
  if (held === 0n) { console.log(`  outcomeIdx=${idx}: nothing held`); continue; }
  const amount = Number(held) / 10 ** dec;
  console.log(`\n>>> redeem outcomeIdx=${idx} amount=${amount}`);
  // RAW tier. The unified redeem() resolves its ref through loadMarkets(),
  // which deliberately excludes finalized markets — so on the exact markets you
  // need to claim from, it can never find the ref. ec-core goes through the
  // trader with an explicit outcomeIdx for this reason, and so do we.
  const trader = (ex as any).trader;
  console.log("  trader reachable:", !!trader, "| redeem:", typeof trader?.redeem);
  try {
    const r = await trader.redeem({
      marketId: ID,
      market: oc.marketAddress,
      outcomeToken: oc.outcomeToken,
      outcomeIdx: idx,
      amount: held,
    });
    console.log("### REDEEM RESULT:"); console.log(j(r, 900));
  } catch (e: any) {
    console.log("raw redeem failed:", String(e?.message).slice(0, 320));
  }
}
