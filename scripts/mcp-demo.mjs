/**
 * Drive the PRISM MCP server the way Claude Desktop does, and print what it says.
 *
 * Speaks real JSON-RPC over stdio to `backend/mcp/index.ts` — no mocks, no
 * stubs. Exists because "the MCP server works" is a claim, and the only honest
 * form of that claim is a transcript of it answering.
 *
 *   node scripts/mcp-demo.mjs
 */

import { spawn } from "node:child_process";

const child = spawn(
  process.env.COMSPEC || "cmd.exe",
  ["/c", "bun", "--conditions", "react-server", "backend/mcp/index.ts"],
  { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
);

let buffer = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }
    }, 60_000);
  });

const call = async (name, args = {}) => {
  const r = await send("tools/call", { name, arguments: args });
  const text = r?.result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const rule = (s) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "prism-demo", version: "1.0.0" },
  });

  const tools = await send("tools/list");
  rule("Tools exposed");
  console.log(tools.result.tools.map((t) => t.name).join(", "));

  rule("get_policy");
  console.log(JSON.stringify(await call("get_policy"), null, 2));

  rule("list_markets (routable only)");
  const markets = await call("list_markets", { routableOnly: true });
  console.log(`registry ${markets.totalInRegistry} rows · ${markets.venues} venues · ${markets.count} routable`);
  for (const m of (markets.markets ?? []).slice(0, 5))
    console.log(
      `  ${m.asset} ${String(m.interval).padEnd(4)} strike ${String(m.strike).padEnd(10)} ` +
        `${m.secondsToExpiry}s left · allowedByPolicy=${m.allowedByPolicy}`,
    );

  const first = (markets.markets ?? [])[0];
  if (first) {
    rule(`get_order_book — ${first.asset} ${first.interval} YES`);
    console.log(JSON.stringify(await call("get_order_book", { marketId: first.marketId, outcome: "YES" }), null, 2));
  }

  rule("get_structures");
  const st = await call("get_structures");
  for (const s of st.matrix ?? [])
    console.log(`  ${s.constructible ? "yes" : "no "} ${String(s.kind).padEnd(12)} ${s.reason}`);

  // The point of the whole exercise: an order the policy refuses.
  if (first) {
    rule("place_order — expected to be REFUSED by policy");
    console.log(
      JSON.stringify(await call("place_order", { marketId: first.marketId, outcome: "YES", size: 1 }), null, 2),
    );
  }

  rule("place_order on a market OUTSIDE the allowlist");
  console.log(
    JSON.stringify(await call("place_order", { marketId: "0xnot-in-allowlist", outcome: "YES", size: 1 }), null, 2),
  );

  rule("revoke_session, then try to spend again");
  console.log(JSON.stringify(await call("revoke_session"), null, 2));
  if (first)
    console.log(
      JSON.stringify(await call("place_order", { marketId: first.marketId, outcome: "YES", size: 1 }), null, 2),
    );
} catch (e) {
  console.error("DEMO FAILED:", e.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
