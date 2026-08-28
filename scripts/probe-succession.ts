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
let checked = 0;
let withExact = 0;
let withLabelOnly = 0;
for (const m of snap.active.filter((x) => x.expiry > now).sort((a,b)=>a.expiry-b.expiry)) {
  checked++;
  const exact = successionChain(snap, m.asset, m.intervalSec).find((x) => x.expiry > m.expiry);
  // What a label-based match would find instead.
  const loose = snap.all
    .filter((x) => x.asset === m.asset && x.interval === m.interval && x.expiry > m.expiry)
    .sort((a, b) => a.expiry - b.expiry)[0];
  if (exact) withExact++;
  else if (loose) withLabelOnly++;
  const tag = !exact && loose ? "  <-- EXACT MISSES IT, LABEL FINDS IT" : "";
  console.log(
    `  ${m.asset} ${m.interval.padEnd(5)} (${String(m.intervalSec).padEnd(5)}) exp ${m.expiry}` +
    `  exact:${exact ? "yes" : "NO "}  label:${loose ? "yes" : "NO "}${tag}`,
  );
}
// A machine-readable verdict, so this stops being a wall of lines somebody has
// to read. `docs/evidence/README.md` and the worklog both point at this line as
// the reproduction of the open roll claim.
const verdict =
  withExact > 0
    ? "SUCCESSORS_LISTED"
    : withLabelOnly > 0
      ? "SUCCESSORS_LISTED_BY_LABEL_ONLY"
      : "NO_SUCCESSOR_LISTED";
console.log(
  `\nVERDICT ${verdict}  checked=${checked} exact=${withExact} label_only=${withLabelOnly}`,
);
process.exit(0);
