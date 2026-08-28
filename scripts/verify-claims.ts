/**
 * Reproduce every capability claim PRISM makes, against the live chain.
 *
 * The README says three things that used to be unfalsifiable prose: EIP-7702 is
 * unavailable on this chain, the venue lists one strike per window, and Range /
 * Spread / Ladder therefore cannot be routed. A reader had to take all three on
 * trust, and a claim nobody can re-run is indistinguishable from a claim nobody
 * checked — which is exactly how "EIP-7702 (planned)" survived in the UI for a
 * standard the chain does not implement.
 *
 * This prints the evidence behind each one and exits non-zero if the live venue
 * disagrees with what the repository says about it.
 *
 *   bun --conditions react-server scripts/verify-claims.ts
 *
 * Read-only: no key is used, nothing is signed, nothing is sent.
 */

import { getMarketSnapshot, successionChain } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";
import { probeChainCapabilities } from "../sdk/venue/capabilities";
import { structureMatrix, maxStrikesOnOneExpiry } from "../sdk/venue/structures";

const config = resolveVenueConfig();
const rule = (s: string) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

let failures = 0;
const check = (claim: string, holds: boolean, detail: string) => {
  if (!holds) failures++;
  console.log(`  ${holds ? "HOLDS " : "BROKEN"}  ${claim}`);
  console.log(`          ${detail}`);
};

async function main() {
  console.log(`PRISM claim verification · ${config.network} · chain ${config.chainId}`);
  console.log(`rpc     ${config.rpc}`);
  console.log(`indexer ${config.indexer}`);

  /* ---- 1. Chain capabilities ------------------------------------- */
  rule("1. EIP-7702 / fork detection");
  const caps = await probeChainCapabilities(config);
  for (const e of caps.evidence) console.log(`  ${e}`);
  check(
    "the README's claim that EIP-7702 is unavailable here",
    !caps.eip7702,
    caps.eip7702
      ? "Prague IS live. EIP-7702 is now available and the docs must be updated to say so."
      : "No Prague system contracts, so set-code transactions cannot exist on this chain.",
  );

  /* ---- 2. One strike per window ---------------------------------- */
  rule("2. Strikes per window");
  const snap = await getMarketSnapshot(config);
  const strikes = maxStrikesOnOneExpiry(snap.all);
  console.log(`  markets read            ${snap.all.length}`);
  console.log(`  active                  ${snap.active.length}`);
  console.log(`  routable                ${snap.routable.length}`);
  console.log(`  venue ids seen          ${Object.keys(snap.venues).length}`);
  for (const [id, n] of Object.entries(snap.venues).sort((a, b) => b[1] - a[1]))
    console.log(`     ${id.slice(0, 18)}…  ${n}`);
  // Underlyings and discarded rows, both read off the registry. The asset list
  // used to be a hard-coded pair and a third one would have been dropped in
  // silence; printing what was actually seen is how that stays visible.
  console.log(`  underlyings seen        ${Object.keys(snap.assets).length}`);
  for (const [a, n] of Object.entries(snap.assets).sort((x, y) => y[1] - x[1]))
    console.log(`     ${a.padEnd(18)}  ${n}`);
  console.log(`  rows PRISM could not read  ${snap.droppedTotal}`);
  for (const [reason, n] of Object.entries(snap.dropped).sort((x, y) => y[1] - x[1]))
    console.log(`     ${reason.padEnd(18)}  ${n}`);
  check(
    "no BINARY row was discarded for an unreadable underlying or cadence",
    (snap.dropped.NO_ASSET ?? 0) === 0 && (snap.dropped.NO_INTERVAL ?? 0) === 0,
    `NO_ASSET ${snap.dropped.NO_ASSET ?? 0}, NO_INTERVAL ${snap.dropped.NO_INTERVAL ?? 0} ` +
      "(NOT_BINARY rows are expected — the registry carries spot and perp too)",
  );
  check(
    "the venue lists one strike per window",
    strikes <= 1,
    `most distinct strikes on any single expiry: ${strikes}`,
  );

  /* ---- 3. Constructibility follows from 2 ------------------------ */
  rule("3. Constructible structures");
  const matrix = structureMatrix(snap.all);
  for (const m of matrix)
    console.log(`  ${(m.constructible ? "yes" : "no ").padEnd(4)} ${m.kind.padEnd(12)} ${m.reason}`);

  const blocked = matrix.filter((m) => !m.constructible).map((m) => m.kind);
  check(
    "Range, Spread and Ladder are not constructible",
    ["RANGE", "SPREAD", "LADDER"].every((k) => blocked.includes(k as never)),
    blocked.length
      ? `blocked: ${blocked.join(", ")}`
      : "ALL structures are constructible — the venue has changed and the docs are now wrong.",
  );

  /* ---- 4. Successor availability --------------------------------- */
  //
  // Reported, never asserted. The README's last open item is that no live roll
  // has fired, and the reason given is that the venue does not pre-strike
  // successors. That is a claim about the venue, so it is measured here rather
  // than repeated: this is NOT a check() — a listed successor is good news, not
  // a failure — but it puts the number in the same place as everything else.
  rule("4. Successor availability (reported, not asserted)");
  {
    const nowSec = Math.floor(Date.now() / 1000);
    const liveNow = snap.active.filter((m) => m.expiry > nowSec);
    let withSuccessor = 0;
    for (const m of liveNow) {
      const next = successionChain(snap, m.asset, m.intervalSec).find((x) => x.expiry > m.expiry);
      if (next) withSuccessor++;
    }
    console.log(`  live markets            ${liveNow.length}`);
    console.log(`  with a listed successor ${withSuccessor}`);
    console.log(
      withSuccessor === 0
        ? "  NO_SUCCESSOR_LISTED — matches the open claim in docs/worklog.md."
        : `  SUCCESSORS_LISTED — run scripts/roll-watch.ts now; the roll claim can be closed.`,
    );
  }

  /* ---- Verdict ---------------------------------------------------- */
  rule("Verdict");
  if (failures) {
    console.log(`  ${failures} claim(s) no longer hold against the live venue.`);
    console.log("  This is not necessarily a bug — the venue may have gained a capability.");
    console.log("  Either way the repository is now saying something untrue. Update it.");
    process.exit(1);
  }
  console.log("  Every capability claim in the README holds against the live venue.");
  process.exit(0);
}

await main();
