/** Which routable leg can actually be bought right now? Read-only. */
import { getMarketSnapshot, exchange } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";
import { isRoutable } from "../sdk/venue/types";

const config = resolveVenueConfig();
const snap = await getMarketSnapshot(config);
const ex = exchange(config);
const live = snap.routable.filter((m) => isRoutable(m, Date.now()));

console.log(`${live.length} routable right now\n`);
let any = false;
for (const m of live) {
  const left = m.expiry - Math.floor(Date.now() / 1000);
  for (const o of ["YES", "NO"] as const) {
    let best: [number, number] | undefined, depth = 0;
    try {
      const ob = await ex.fetchOrderBook(`${m.symbol}#${o}`);
      const asks = (ob.asks ?? []) as [number, number][];
      best = asks[0];
      depth = asks.reduce((n, [, s]) => n + s, 0);
    } catch { /* treat as no book */ }
    const tag = best ? `ask ${best[0].toFixed(3)} x ${best[1]}  (depth ${depth})  <== BUYABLE` : "no offer";
    if (best) any = true;
    console.log(`  ${m.asset} ${m.interval.padEnd(4)} ${o.padEnd(3)}  ${String(left).padStart(4)}s left   ${tag}`);
  }
}
console.log(any ? "\nAt least one leg is buyable." : "\nNothing is quoting on either side of any routable market.");
process.exit(0);
