import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

const all = Object.values(await ex.loadMarkets(true)) as any[];
const bins = all.filter((m) => m.type === "binary");
const now = Math.floor(Date.now() / 1000);

// group by asset+cadence, ordered by expiry — the succession chain
const chains = new Map<string, any[]>();
for (const m of bins) {
  const k = `${m.info.asset}-${m.info.intervalSec}`;
  if (!chains.has(k)) chains.set(k, []);
  chains.get(k)!.push(m);
}

console.log("### CHAINS WITH A STRUCK SUCCESSOR");
for (const [k, ms] of chains) {
  const sorted = ms.sort((a, b) => Number(a.info.expiry) - Number(b.info.expiry));
  const live = sorted.find((m) => m.active && Number(m.info.expiry) > now);
  if (!live) continue;
  const next = sorted.find((m) => Number(m.info.expiry) > Number(live.info.expiry));
  if (!next) { console.log(`  ${k}: live ok, NO successor listed`); continue; }
  const struck = next.info.strike && next.info.strike !== "0";
  console.log(`  ${k}: live=${Number(live.info.expiry)-now}s | successor ${struck ? "STRUCK "+Number(next.info.strike)/100 : "unstruck"} status=${next.info.status}`);
  if (!struck) continue;

  for (const o of ["YES","NO"]) {
    try {
      const ob = await ex.fetchOrderBook(`${next.symbol}#${o}`);
      const ask = (ob.asks ?? [])[0];
      console.log(`      successor ${o} best ask: ${ask ? ask[0]+" x "+ask[1] : "(none)"}`);
      if (ask) console.log(`      >>> ROLLABLE: marketId=${live.info.marketId} outcome=${o} price=${ask[0]}`);
    } catch { console.log(`      ${o} book unavailable`); }
  }
}
