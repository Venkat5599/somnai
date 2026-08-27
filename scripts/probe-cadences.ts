import { getMarketSnapshot } from "../sdk/venue/markets";
import { INTERVALS } from "../sdk/venue/config";
const snap = await getMarketSnapshot();
const seen = new Map<number, { label: string; all: number; active: number }>();
for (const m of snap.all) {
  const e = seen.get(m.intervalSec) ?? { label: m.interval, all: 0, active: 0 };
  e.all++; if (m.active) e.active++;
  seen.set(m.intervalSec, e);
}
const known = new Set<number>(INTERVALS.map((i) => i.sec));
console.log("sec      label   all  active  in INTERVALS?");
for (const [sec, e] of [...seen].sort((a, b) => a[0] - b[0]))
  console.log(`${String(sec).padEnd(8)} ${e.label.padEnd(7)} ${String(e.all).padStart(3)}  ${String(e.active).padStart(6)}  ${known.has(sec) ? "yes" : "NO  <-- missing"}`);
process.exit(0);
