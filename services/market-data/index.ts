/**
 * PRISM Market Data — the read fan-out.
 *
 * WHY IT EXISTS: the registry is identical for every user, and pulling it takes
 * 1.2-4.9s against an indexer that times out under a single client. Measured.
 * Every web instance holding its own cache means N instances x 6 pulls/min; one
 * shared service means 6 pulls/min total no matter how many web instances run.
 *
 * It holds NO KEY and can therefore scale horizontally without limit — the
 * exact opposite of the executor, which must stay single-writer. That asymmetry
 * is the whole reason these are two services rather than one.
 *
 * Failure mode is deliberate: when the upstream indexer dies, this serves the
 * last good snapshot and MARKS IT STALE. A stale registry with an honest label
 * beats an error page for every user during a blip — but it must never be
 * passed off as live, so `stale` and `ageMs` ride on every response.
 */

import { serve } from "bun";
import { getMarketSnapshot, successionChain, type MarketSnapshot } from "../../sdk/venue/markets";
import { getPriceSnapshot } from "../../sdk/venue/prices";
import { emit, snapshot as metrics, tracked, withRetry } from "../../sdk/observability";
import type { Asset } from "../../sdk/venue/types";

const PORT = Number(process.env.MARKET_DATA_PORT ?? 8082);
const REGISTRY_TTL_MS = Number(process.env.MARKET_TTL_MS ?? 10_000);
const PRICE_TTL_MS = Number(process.env.PRICE_TTL_MS ?? 5_000);

/* ------------------------------------------------------------------ */

interface Cached<T> {
  value: T;
  at: number;
}

let registry: Cached<MarketSnapshot> | null = null;
let inflight: Promise<MarketSnapshot> | null = null;

/**
 * Single-flight refresh.
 *
 * Without this, a cold cache under load sends one upstream pull per concurrent
 * request — a thundering herd that hits the indexer hardest exactly when it is
 * already struggling. Sharing one in-flight promise collapses them to one.
 */
async function readRegistry(): Promise<{ snap: MarketSnapshot; stale: boolean; ageMs: number }> {
  const now = Date.now();
  if (registry && now - registry.at < REGISTRY_TTL_MS)
    return { snap: registry.value, stale: false, ageMs: now - registry.at };

  if (!inflight) {
    inflight = withRetry("marketdata.registry", () => getMarketSnapshot())
      .then((v) => {
        registry = { value: v, at: Date.now() };
        return v;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    const snap = await inflight;
    return { snap, stale: false, ageMs: 0 };
  } catch (e) {
    if (registry) {
      emit({
        level: "warn",
        op: "marketdata.stale",
        meta: { ageMs: Date.now() - registry.at, reason: e instanceof Error ? e.message.slice(0, 120) : "?" },
      });
      return { snap: registry.value, stale: true, ageMs: Date.now() - registry.at };
    }
    throw e;
  }
}

const prices = new Map<string, Cached<unknown>>();

async function readPrice(asset: Asset, tf: string, limit: number) {
  const key = `${asset}:${tf}:${limit}`;
  const hit = prices.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.value;

  const v = await withRetry("marketdata.price", () =>
    getPriceSnapshot(asset, tf as "1m" | "1h" | "1d", limit),
  );
  prices.set(key, { value: v, at: Date.now() });
  return v;
}

/* ------------------------------------------------------------------ */

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "market-data",
        cachedRegistry: Boolean(registry),
        registryAgeMs: registry ? Date.now() - registry.at : null,
        priceKeys: prices.size,
        ...metrics(),
      });
    }

    try {
      if (url.pathname === "/markets") {
        const { snap, stale, ageMs } = await tracked("marketdata.markets", readRegistry);
        return json(
          {
            all: snap.all,
            active: snap.active,
            routable: snap.routable,
            venues: snap.venues,
            fetchedAt: snap.fetchedAt,
            network: snap.network,
            stale,
            ageMs,
          },
          200,
          // Let a CDN absorb the fan-out too.
          { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" },
        );
      }

      if (url.pathname === "/succession") {
        const asset = (url.searchParams.get("asset") ?? "BTC") as Asset;
        const sec = Number(url.searchParams.get("intervalSec") ?? 300);
        const { snap, stale } = await readRegistry();
        return json({ windows: successionChain(snap, asset, sec), stale });
      }

      if (url.pathname === "/price") {
        const asset = (url.searchParams.get("asset") ?? "BTC") as Asset;
        const tf = url.searchParams.get("tf") ?? "1m";
        const limit = Number(url.searchParams.get("limit") ?? 240);
        return json(await tracked("marketdata.price", () => readPrice(asset, tf, limit)), 200, {
          "cache-control": "public, s-maxage=5, stale-while-revalidate=15",
        });
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 503);
    }

    return json({ error: "not found" }, 404);
  },
});

emit({ level: "info", op: "marketdata.start", meta: { port: PORT, registryTtlMs: REGISTRY_TTL_MS } });
console.log(`market-data listening on :${PORT} (no key, horizontally scalable)`);
