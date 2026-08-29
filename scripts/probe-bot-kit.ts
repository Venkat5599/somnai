/**
 * Check PRISM's strategy list against the bot kit's, live.
 *
 * WHY THIS EXISTS. `EC_STRATEGIES` was transcribed once from the Builder's
 * dropdown and then never compared to anything. It drifted in both directions
 * and nobody could have noticed:
 *
 *   - it MISSED `ec-oracle-follow` entirely, so the README said "all five run"
 *     about a set with six members;
 *   - it INVENTED `ec-market-maker`, `ec-passive-bid` and `ec-ladder`, and the
 *     parser rejected everything else — so a config carrying the kit's own
 *     documented `STRATEGY=ec-maker` failed to load.
 *
 * This is the same defect as the `INTERVALS` and `KNOWN_VENUE_IDS` constants,
 * and it has the same fix: stop asserting a fact about an external system and
 * go read it. A hand-written list checked against nothing rots silently; a
 * hand-written list checked against its source fails loudly the day it is
 * wrong, which is the only difference that matters.
 *
 *   bun scripts/probe-bot-kit.ts
 *
 * Exits non-zero when the kit lists a strategy PRISM does not know, or PRISM
 * claims one the kit no longer ships. Network-only, signs nothing.
 */

import { EC_STRATEGIES, STRATEGY_ALIASES, STRATEGY_SUPPORT } from "../sdk/bot/config";

const DOC =
  "https://raw.githubusercontent.com/somnia-chain/dreamdex-bot-kit/main/docs/event-contracts.md";
const README =
  "https://raw.githubusercontent.com/somnia-chain/dreamdex-bot-kit/main/README.md";

const rule = (s: string) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

/** Every `ec-…` token the kit's own text mentions. */
async function kitStrategies(): Promise<{ found: Set<string>; sources: string[] }> {
  const found = new Set<string>();
  const sources: string[] = [];

  for (const url of [DOC, README]) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        sources.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      // Strategy values are kebab-case and always prefixed `ec-`.
      for (const m of text.matchAll(/\bec-[a-z0-9]+(?:-[a-z0-9]+)*\b/g)) found.add(m[0]);
      sources.push(`${url} -> ok`);
    } catch (e) {
      sources.push(`${url} -> ${e instanceof Error ? e.message.slice(0, 70) : "failed"}`);
    }
  }
  return { found, sources };
}

/**
 * Tokens that match `ec-…` but are not strategies.
 *
 * The kit's docs name its shared package `@dreamdex-bot-kit/ec-core` in the
 * same tables as the strategies, so a naive scan reports `ec-core` as a
 * strategy PRISM is missing. Listed explicitly rather than filtered by a
 * heuristic, so adding to it is a visible decision.
 */
const NOT_STRATEGIES = new Set(["ec-core", "ec-contracts", "ec-common"]);

async function main() {
  console.log("PRISM ↔ dreamdex-bot-kit strategy reconciliation");

  const { found, sources } = await kitStrategies();
  rule("Sources");
  for (const s of sources) console.log(`  ${s}`);

  if (found.size === 0) {
    console.log("\n  Could not read the kit at all. Not treating an unreachable");
    console.log("  network as agreement — this is UNVERIFIED, not a pass.");
    process.exit(3);
  }

  const kit = [...found].filter((s) => !NOT_STRATEGIES.has(s)).sort();
  // Widened deliberately: this probe compares against strings scraped from the
  // kit's docs, and the whole point is to detect a value OUTSIDE the union.
  const ours: string[] = [...EC_STRATEGIES].sort();
  const aliases = new Set(Object.keys(STRATEGY_ALIASES));

  rule("Kit ships");
  for (const s of kit) console.log(`  ${s}`);

  rule("PRISM accepts");
  for (const s of ours) console.log(`  ${s.padEnd(18)} canonical`);
  for (const s of [...aliases].sort()) console.log(`  ${s.padEnd(18)} alias -> ${STRATEGY_ALIASES[s]}`);

  // --- the two directions of drift
  const missing = kit.filter((s) => !ours.includes(s) && !aliases.has(s));
  const extra = ours.filter((s) => !kit.includes(s));
  // A strategy with no support entry would crash the dispatcher at run time.
  const unwired = ours.filter((s) => !(s in (STRATEGY_SUPPORT as Record<string, unknown>)));

  rule("Verdict");
  let failures = 0;

  if (missing.length) {
    failures++;
    console.log(`  DRIFT   the kit ships ${missing.length} strategy PRISM does not know:`);
    for (const s of missing) console.log(`            ${s}`);
    console.log("          Add it to EC_STRATEGIES, STRATEGY_SUPPORT and the dispatcher.");
  } else {
    console.log("  HOLDS   every strategy the kit ships is accepted by PRISM");
  }

  if (extra.length) {
    failures++;
    console.log(`  DRIFT   PRISM claims ${extra.length} the kit does not mention:`);
    for (const s of extra) console.log(`            ${s}`);
    console.log("          Either the kit dropped it or PRISM invented it. Check which.");
  } else {
    console.log("  HOLDS   every strategy PRISM claims is one the kit ships");
  }

  if (unwired.length) {
    failures++;
    console.log(`  BROKEN  no STRATEGY_SUPPORT entry for: ${unwired.join(", ")}`);
  } else {
    console.log("  HOLDS   every accepted strategy has a support entry");
  }

  console.log("");
  if (failures) {
    console.log(`  ${failures} discrepancy(ies). The repository is now saying something`);
    console.log("  untrue about the bot kit. Update it.");
    process.exit(1);
  }
  console.log("  PRISM's strategy list matches the kit.");
  process.exit(0);
}

await main();
