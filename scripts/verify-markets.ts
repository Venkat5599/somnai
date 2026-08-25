/** Proves the real read path executes against the live venue. */
import { getMarketSnapshot, marketsForAsset, termStructure, successionChain } from "../src/lib/venue/markets";

const snap = await getMarketSnapshot();
console.log(`network      ${snap.network}`);
console.log(`binary rows  ${snap.all.length}`);
console.log(`active       ${snap.active.length}`);
console.log(`routable     ${snap.routable.length}   (active + Trading + struck + outside headroom)`);
console.log(`venues       ${Object.keys(snap.venues).length}`);

console.log("\n--- ACTIVE MARKETS (normalized) ---");
for (const a of ["BTC", "ETH"] as const) {
  for (const m of marketsForAsset(snap, a)) {
    const left = m.expiry - Math.floor(Date.now() / 1000);
    console.log(
      `${m.asset.padEnd(4)} ${m.interval.padEnd(5)} strike=${String(m.strike ?? "UNSTRUCK").padEnd(10)} ` +
      `${m.status.padEnd(8)} ${String(left)+"s left"} ${m.marketId.slice(0, 12)}…`
    );
  }
}

console.log("\n--- TERM STRUCTURE (PRISM's real axis) ---");
for (const a of ["BTC", "ETH"] as const) {
  const ts = termStructure(snap, a);
  console.log(`${a}: ${ts.length ? ts.map(p => `${p.interval}@${p.strike}`).join("  ") : "(no struck markets)"}`);
}

console.log("\n--- SUCCESSION CHAIN (Roll Engine input) ---");
const chain = successionChain(snap, "BTC", 300);
console.log(`BTC 5m windows in registry: ${chain.length}`);
console.log(chain.slice(-4).map(m => `  ${new Date(m.expiry*1000).toISOString().slice(11,16)} ${m.status} strike=${m.strike ?? "-"}`).join("\n"));
