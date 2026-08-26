/** Poll the fast chains until a successor is struck AND liquid, then roll into it. */
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

const DEADLINE = Date.now() + 4 * 60 * 1000;
let attempt = 0;

while (Date.now() < DEADLINE) {
  attempt++;
  const all = Object.values(await ex.loadMarkets(true)) as any[];
  const now = Math.floor(Date.now() / 1000);
  const bins = all.filter((m) => m.type === "binary" && Number(m.info.intervalSec) <= 300);

  const chains = new Map<string, any[]>();
  for (const m of bins) {
    const k = `${m.info.asset}-${m.info.intervalSec}`;
    if (!chains.has(k)) chains.set(k, []);
    chains.get(k)!.push(m);
  }

  for (const [k, ms] of chains) {
    const sorted = ms.sort((a, b) => Number(a.info.expiry) - Number(b.info.expiry));
    const live = sorted.find((m) => m.active && Number(m.info.expiry) > now);
    if (!live) continue;
    const next = sorted.find((m) => Number(m.info.expiry) > Number(live.info.expiry));
    if (!next || !next.info.strike || next.info.strike === "0") continue;

    for (const o of ["YES", "NO"] as const) {
      let ask: [number, number] | undefined;
      try {
        const ob = await ex.fetchOrderBook(`${next.symbol}#${o}`);
        ask = ((ob.asks ?? []) as [number,number][])[0];
      } catch {}
      if (!ask) continue;

      console.log(`\n### ROLLABLE on ${k} (attempt ${attempt})`);
      console.log(`  from ${live.info.marketId.slice(0,14)}… -> into ${next.info.marketId.slice(0,14)}…`);
      console.log(`  successor strike ${Number(next.info.strike)/100} | ${o} ask ${ask[0]} x ${ask[1]}`);

      // roll = open the equivalent leg in the successor, grid-safe raw tier
      const oc = await (ex as any).client.getMarketOnchain(next.info.marketId);
      const one = 10n ** BigInt(Number(oc.decimals ?? 6));
      const tick = 1000n, lot = 1n;
      const steps = (h:number, st:bigint, mode:"round"|"floor") => {
        const per = Number(one / st); const n = h * per;
        return BigInt(Math.max(0, mode==="round"?Math.round(n):Math.floor(n+1e-9))) * st;
      };
      const quantity = steps(1, lot, "floor");
      const priceOwn = steps(ask[0], tick, "round");
      const priceYes = o === "YES" ? priceOwn : one - priceOwn;
      const expiresAt = Math.min(now + 120, Number(oc.expiry));

      try {
        const res = await (ex as any).trader.placeOrder({
          pool: oc.pool,
          side: o === "YES" ? "BUY_YES" : "BUY_NO",
          price: priceYes, quantity,
          outcomeToken: oc.outcomeToken, yesId: oc.yesId, noId: oc.noId,
          orderType: 2,
          expireTimestampNs: BigInt(expiresAt) * 1_000_000_000n,
        });
        console.log("### ROLL LEG RESULT:"); console.log(j(res, 700));
        console.log("hash:", res?.hash, "| receipt:", res?.receipt?.status);
        process.exit(0);
      } catch (e:any) {
        console.log("  roll leg failed:", String(e?.message).slice(0,240));
      }
    }
  }
  process.stdout.write(`.`);
  await new Promise((r) => setTimeout(r, 12000));
}
console.log("\nno rollable successor appeared within the window");
