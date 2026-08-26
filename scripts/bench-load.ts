import { getMarketSnapshot } from "../src/lib/venue/markets";
import { getPriceSnapshot } from "../src/lib/venue/prices";

const t = async <T>(label: string, fn: () => Promise<T>) => {
  const s = Date.now();
  try { const r = await fn(); console.log(`  ${label.padEnd(22)} ${String(Date.now()-s).padStart(6)}ms`); return r; }
  catch (e: any) { console.log(`  ${label.padEnd(22)} FAILED ${String(e?.message).slice(0,60)}`); return null; }
};

console.log("### cold (first request after boot)");
const snap = await t("getMarketSnapshot", () => getMarketSnapshot());
await t("getPriceSnapshot BTC", () => getPriceSnapshot("BTC", "1m", 240));

console.log("\n### warm x5 (what every subsequent user pays)");
for (let i = 0; i < 5; i++) await t(`snapshot #${i+1}`, () => getMarketSnapshot());

console.log(`\nrows: ${snap?.all.length ?? 0}  active: ${snap?.active.length ?? 0}`);
console.log("\n### upstream calls per page render, today");
console.log("  /markets  1 registry pull");
console.log("  /trade    1 registry + 2 order books + 1 oracle snapshot = 4");
console.log("  /roll     1 registry");
console.log("  /proof    2 RPC receipts");
console.log("  NOTHING IS CACHED - every user pays this in full");
