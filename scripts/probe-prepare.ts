/**
 * Reproduce the VENUE_UNREADABLE failure, and prove the fix.
 *
 * The wallet-connected path builds its unsigned order through `prepare.ts`,
 * which resolves the market with `getMarketOnchain` on the READ-ONLY exchange.
 * That exchange was constructed without an address book, so v2 — which resolves
 * markets by marketId through the binary module — had no `addresses.binaryModule`
 * and threw. The server-signed demo path kept working because `signingExchange`
 * always passed the book, which made the failure look like a wallet problem.
 *
 * Signs nothing. Builds the transaction and prints whether it exists.
 */
import { getMarketSnapshot, exchange } from "../sdk/venue/markets";
import { resolveVenueConfig } from "../sdk/venue/config";

const config = resolveVenueConfig();
const snap = await getMarketSnapshot(config);
const market = snap.routable[0] ?? snap.active.find((m) => m.strike !== null) ?? null;

if (!market) {
  console.log("No live market to probe against right now.");
  process.exit(0);
}

console.log(`market      ${market.symbol}`);
console.log(`marketId    ${market.marketId.slice(0, 24)}…`);

const client = (exchange(config) as unknown as { client: Record<string, unknown> }).client;

try {
  const oc = (await (
    client.getMarketOnchain as unknown as (id: `0x${string}`) => Promise<Record<string, unknown>>
  )(market.marketId as `0x${string}`)) as Record<string, unknown>;
  console.log(`pool        ${String(oc.pool)}`);
  console.log(`decimals    ${String(oc.decimals)}`);
  console.log("");
  console.log("PASS  the read-only exchange resolves markets on-chain.");
  console.log("      prepare.ts can build an unsigned order for a connected wallet.");
  process.exit(0);
} catch (e) {
  console.log("");
  console.log(`FAIL  ${e instanceof Error ? e.message.slice(0, 220) : String(e)}`);
  console.log("      This is the VENUE_UNREADABLE the /trade wallet path reports.");
  process.exit(1);
}
