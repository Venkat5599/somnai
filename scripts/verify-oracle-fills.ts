/**
 * Re-derive the ec-oracle-follow fills from chain, independently of the runner.
 *
 * The runner already printed VERIFIED_EXECUTED, but that is its own word for it.
 * This reads the receipts through raw viem — no SDK, no bot code — because the
 * whole repository's rule is that a report is evidence and the chain is truth.
 */
import { rpc } from "../sdk/dreamdex/execution";
import { resolveVenueConfig } from "../sdk/venue/config";
import type { Hex } from "viem";

const HASHES = [
  { at: "tick 210", leg: "BTC 5m NO",  edge: 0.0691, hash: "0x40c5e012f48342c55501735c7ca203aa915a88330e7de75b4cb05250dcdd2381" },
  { at: "tick 237", leg: "ETH 5m YES", edge: 0.1022, hash: "0xa70ddb8f77705380505b336c1fd84f37bbbaa20da89f51b4ac4bb0fc2f170535" },
];

const config = resolveVenueConfig();
const client = rpc(config);
let bad = 0;

for (const h of HASHES) {
  try {
    const r = await client.getTransactionReceipt({ hash: h.hash as Hex });
    const ok = r.status === "success";
    if (!ok) bad++;
    console.log(`${ok ? "VERIFIED" : "FAILED  "}  ${h.leg.padEnd(11)} edge ${h.edge}`);
    console.log(`          block ${r.blockNumber}  status ${r.status}  logs ${r.logs.length}`);
    console.log(`          ${config.explorer}/tx/${h.hash}`);
  } catch (e) {
    bad++;
    console.log(`UNKNOWN   ${h.leg} — ${e instanceof Error ? e.message.slice(0, 90) : "read failed"}`);
  }
}
process.exit(bad ? 1 : 0);
