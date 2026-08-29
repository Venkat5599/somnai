/**
 * PRISM's MCP server over HTTP, so it can be hosted rather than spawned.
 *
 *   MCP_HTTP_TOKEN=<32+ chars> bun --conditions react-server backend/mcp/http.ts
 *
 * WHY THIS EXISTS SEPARATELY. Claude Desktop reaches a stdio server by spawning
 * a local process — there is no URL to point at, so a stdio server cannot be
 * "deployed" no matter where the code sits. Making it reachable is a TRANSPORT
 * change, not a deployment step. That is this file.
 *
 * A HOSTED MCP THAT CAN SPEND IS AN OPEN ENDPOINT, which is the whole risk. On
 * stdio the operating system protects it: only someone who can run processes on
 * the machine can reach it. Over HTTP that protection is gone, so:
 *
 *   - a bearer token is MANDATORY. The process refuses to listen without
 *     MCP_HTTP_TOKEN rather than defaulting to open, because a hosted trading
 *     endpoint with no auth is worse than no endpoint at all.
 *   - the token is compared in constant time, so it cannot be narrowed down one
 *     byte at a time from response latency.
 *   - the budget stays per-PROCESS, not per-connection. Ten clients share one
 *     spend cap; the alternative is an endpoint whose exposure grows with the
 *     number of people who find it.
 *   - dry-run remains the default, exactly as on stdio.
 *
 * Binds to 127.0.0.1 unless MCP_HTTP_HOST says otherwise, so it is never
 * exposed to a network by accident. TLS is the operator's job — this process
 * speaks plain HTTP and says so rather than implying otherwise.
 */

import { timingSafeEqual, randomUUID } from "node:crypto";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./index";

const PORT = Number(process.env.MCP_HTTP_PORT ?? 8787);
const HOST = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
const TOKEN = process.env.MCP_HTTP_TOKEN ?? "";

if (!TOKEN || TOKEN.length < 24) {
  console.error(
    "FATAL: MCP_HTTP_TOKEN is required and must be at least 24 characters.\n" +
      "A hosted MCP endpoint can place orders. Refusing to listen without auth.",
  );
  process.exit(1);
}

/** Constant time: a wrong token must not be narrowed down by timing replies. */
function tokenOk(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7).trim());
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * A request-scoped transport.
 *
 * An MCP transport is a small interface — start, send, close, and three
 * callbacks — so implementing one honestly is cleaner than bending a Node-shaped
 * transport into Bun's fetch handler. One instance per request means no shared
 * response state and nothing to leak between callers.
 */
class RequestTransport implements Transport {
  onclose?: () => void;
  onerror?: (e: Error) => void;
  onmessage?: (m: JSONRPCMessage) => void;
  sessionId = randomUUID();

  private resolve!: (m: JSONRPCMessage | null) => void;
  private settled = false;
  readonly reply: Promise<JSONRPCMessage | null>;

  constructor() {
    this.reply = new Promise((r) => (this.resolve = r));
  }

  async start() {}

  async send(message: JSONRPCMessage) {
    // Notifications carry no id and expect no reply; resolving on one would
    // return the wrong body for the actual request.
    if (this.settled) return;
    if (typeof message === "object" && message !== null && "id" in message) {
      this.settled = true;
      this.resolve(message);
    }
  }

  async close() {
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
    this.onclose?.();
  }
}

const server = buildServer();

Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,

  async fetch(req) {
    const url = new URL(req.url);

    // Liveness needs no auth: it reveals nothing, and it lets a proxy or a
    // reviewer confirm the process is up without holding a credential.
    if (url.pathname === "/health")
      return Response.json({
        ok: true,
        service: "prism-mcp",
        transport: "http",
        note: "POST JSON-RPC to /mcp with a bearer token",
      });

    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (req.method !== "POST")
      return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });

    if (!tokenOk(req.headers.get("authorization")))
      return Response.json({ error: "unauthorized" }, { status: 401 });

    let body: JSONRPCMessage;
    try {
      body = (await req.json()) as JSONRPCMessage;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const transport = new RequestTransport();
    try {
      await server.connect(transport);
      transport.onmessage?.(body);

      const reply = await Promise.race([
        transport.reply,
        new Promise<null>((r) => setTimeout(() => r(null), 90_000)),
      ]);

      // A notification legitimately produces no response body.
      if (reply === null) return new Response(null, { status: 202 });
      return Response.json(reply);
    } catch (e) {
      return Response.json(
        { error: "internal", detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
        { status: 500 },
      );
    } finally {
      await transport.close().catch(() => {});
    }
  },
});

// stderr, never stdout: stdout is the transport on the stdio sibling, and
// keeping the habit means these two files can never confuse each other.
console.error(
  `[prism-mcp] http://${HOST}:${PORT}/mcp   health: /health\n` +
    `[prism-mcp] bearer token required · budget is per-process, not per-connection · plain HTTP`,
);
