import { getMarketSnapshot, successionChain } from "../sdk/venue/markets";
const snap = await getMarketSnapshot();
const now = Math.floor(Date.now() / 1000);

// Does an exact intervalSec match fragment a cadence the venue itself labels as one?
const byLabel = new Map<string, Set<number>>();
for (const m of snap.all) {
  const k = `${m.asset}|${m.interval}`;
  if (!byLabel.has(k)) byLabel.set(k, new Set());
  byLabel.get(k)!.add(m.intervalSec);
}
console.log("=== cadences the venue labels the same but numbers differently ===");
let frag = 0;
for (const [k, secs] of byLabel) if (secs.size > 1) { frag++; console.log(`  ${k}  ->  ${[...secs].sort((a,b)=>a-b).join(", ")}`); }
if (!frag) console.log("  none");

console.log("\n=== successor visibility for each LIVE market ===");
for (const m of snap.active.filter((x) => x.expiry > now).sort((a,b)=>a.expiry-b.expiry)) {
  const exact = successionChain(snap, m.asset, m.intervalSec).find((x) => x.expiry > m.expiry);
  // What a label-based match would find instead.
  const loose = snap.all
    .filter((x) => x.asset === m.asset && x.interval === m.interval && x.expiry > m.expiry)
    .sort((a, b) => a.expiry - b.expiry)[0];
  const tag = !exact && loose ? "  <-- EXACT MISSES IT, LABEL FINDS IT" : "";
  console.log(
    `  ${m.asset} ${m.interval.padEnd(5)} (${String(m.intervalSec).padEnd(5)}) exp ${m.expiry}` +
    `  exact:${exact ? "yes" : "NO "}  label:${loose ? "yes" : "NO "}${tag}`,
  );
}
process.exit(0);
