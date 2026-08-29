/**
 * The agent SDK, driven against the live venue.
 *
 *   bun --conditions react-server scripts/agent-demo.ts
 *
 * Exists for the same reason scripts/mcp-demo.mjs does: "the SDK works" is a
 * claim, and the only honest form of it is a transcript. Signs nothing — the
 * session is dry-run, so the buy is expected to be REFUSED, which is the
 * behaviour worth showing.
 */
import { createAgent } from "../sdk/agent/client";

const agent = createAgent({ budget: 5, maxOrderContracts: 1, dryRun: true });

const rule = (s: string) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

rule("session");
console.log(agent.state());

rule("markets");
const markets = await agent.markets(true);
console.log(`${markets.length} routable`);
for (const m of markets.slice(0, 4))
  console.log(`  ${m.asset} ${m.interval} strike ${m.strike} · ${m.expiry - Math.floor(Date.now() / 1000)}s left`);

const target = markets[0];
if (!target) {
  console.log("\nNo routable market right now — the board empties between windows.");
  process.exit(0);
}

rule(`quote — ${target.asset} ${target.interval} YES`);
console.log(JSON.stringify(await agent.quote(target.marketId, "YES", 1), null, 2));

rule("buy — expected REFUSED (allowlist empty, and dry-run)");
console.log(JSON.stringify(await agent.buy(target.marketId, "YES", 1), null, 2));

rule("plan a roll");
const plan = await agent.plan(target.marketId, "YES", 1);
console.log(`ok=${plan.ok} blocker=${plan.blocker ?? "-"} ${plan.detail ?? ""}`);

rule("session after");
console.log(agent.state());
process.exit(0);
