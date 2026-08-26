import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
await ex.loadMarkets(true);

const c: any = (ex as any).client;
console.log("client reachable:", !!c, "| has listBinaryMarkets:", typeof c?.listBinaryMarkets);

for (const status of ["Finalized", "Resolved"]) {
  try {
    const rows = await c.listBinaryMarkets({ status, limit: 5 });
    console.log(`\n### status=${status} -> ${rows.length} rows`);
    for (const m of rows.slice(0, 3))
      console.log(`  ${m.symbol ?? m.marketId?.slice(0,14)} win=${m.winningOutcome} finalized=${m.finalized} asset=${m.asset}`);
  } catch (e: any) {
    console.log(`  status=${status} FAILED: ${String(e?.message).slice(0, 180)}`);
  }
}

// our own settled exposure
const ME = "0x8DaB23C096CD074d1c06521B0D5954618611A6a6";
try {
  const p = await c.getPortfolio(ME, { limit: 10 });
  const keys = Object.keys(p ?? {});
  console.log("\n### portfolio keys:", keys.join(", ").slice(0, 200));
  const pos = (p as any)?.positions ?? [];
  console.log("positions:", pos.length);
  for (const x of pos.slice(0, 5)) console.log("  ", JSON.stringify(x).slice(0, 220));
} catch (e: any) { console.log("getPortfolio failed:", String(e?.message).slice(0, 180)); }
