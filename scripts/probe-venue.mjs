import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const ex = new SomniaMarkets({ network:"testnet", chain: somniaShannon,
  rpcUrl:"https://api.infra.testnet.somnia.network",
  indexerUrl:"https://dev.smk.somnia.host/v1/graphql" });

const all = Object.values(await ex.loadMarkets(true));
const live = all.filter(m => m.type === "binary" && m.active);

console.log("### ALL 10 ACTIVE BINARY MARKETS\n");
console.log("asset  interval  strike        expiry(utc)           venue          collat");
for (const m of live.sort((a,b)=> (a.info.asset+a.info.intervalSec).localeCompare(b.info.asset+b.info.intervalSec))) {
  const i = m.info;
  const exp = new Date(Number(i.expiry)*1000).toISOString().replace("T"," ").slice(0,16);
  console.log(
    `${String(i.asset).padEnd(6)} ${String(i.interval).padEnd(9)} ${String(i.strike).padEnd(13)} ${exp}   ${String(i.venueId).slice(0,10)}  ${m.quote}`
  );
}
// THE decisive question: how many distinct strikes per (asset, interval)?
const grp = {};
for (const m of live) {
  const k = `${m.info.asset}/${m.info.interval}`;
  (grp[k] ??= new Set()).add(String(m.info.strike));
}
console.log("\n### STRIKES PER (asset, interval) — a ladder needs >1");
for (const [k,v] of Object.entries(grp)) console.log(`  ${k.padEnd(12)} ${v.size} strike(s): ${[...v].join(", ")}`);

const vs = new Set(live.map(m=>m.info.venueId));
console.log("\n### venues carrying ACTIVE markets:", [...vs].join("\n   "));
console.log("### collateral token:", live[0]?.info?.collateral, " decimals:", live[0]?.info?.quoteDecimals);
