/**
 * PRISM Roll Runner — the always-on half of the product.
 *
 * Event Contract windows are minutes long, and the venue does not pre-strike
 * successors: measured on Shannon, all twelve live chains showed "no successor
 * listed" for four minutes straight. The successor appears only as the current
 * window nears close, and then it exists for minutes.
 *
 * That is precisely why a human cannot run this strategy and a daemon must. A
 * browser tab cannot hold a position across windows; a serverless function
 * cannot either. This process can.
 *
 * WHY A SINGLE LOOP, NOT TIMERS. Claiming and trading sign from the same key,
 * and two senders on one key race each other's nonce — one of them loses with
 * "nonce too low". Driving claim and roll from one sequential loop serialises
 * them for free. This is also why you must never run two runners on one key.
 */

import {
  ORDER_TYPE,
  SomniaMarkets,
  SOMNIA_TESTNET_PRICE_FEED,
  SOMNIA_TESTNET_ADDRESSES,
} from "@somnia-chain/markets-sdk";
import { somniaShannon, somniaMainnet } from "@somnia-chain/markets-sdk/chains";

/* ------------------------------------------------------------------ */

const env = (k: string, d?: string) => process.env[k]?.trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

const NETWORK = env("PRISM_NETWORK", "testnet")!;
const DRY_RUN = env("PRISM_DRY_RUN", "true") !== "false";
const TICK_MS = num("RUNNER_TICK_MS", 15_000);
const CLAIM_EVERY_MS = num("RUNNER_CLAIM_MS", 600_000);
const CLAIM_SCAN = num("RUNNER_CLAIM_SCAN", 25);
const SIZE = num("RUNNER_SIZE", 1);
/** Chains to carry, e.g. "BTC-300,ETH-300". Empty means every fast chain. */
const CHAINS = (env("RUNNER_CHAINS", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_INTERVAL = num("RUNNER_MAX_INTERVAL_SEC", 900);

const PK = process.env.PRIVATE_KEY;

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

if (!PK || !/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  log("FATAL: PRIVATE_KEY missing or malformed. Refusing to start.");
  process.exit(1);
}

const ex = new SomniaMarkets({
  chain: NETWORK === "mainnet" ? somniaMainnet : somniaShannon,
  indexerUrl: env(
    "PRISM_INDEXER_URL",
    NETWORK === "mainnet"
      ? "https://prd.smk.somnia.host/v1/graphql"
      : "https://dev.smk.somnia.host/v1/graphql",
  )!,
  wsRpcUrl: env("PRISM_WS_RPC_URL", "wss://api.infra.testnet.somnia.network/ws"),
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: PK as `0x${string}`,
});

const client = (ex as unknown as { client: Record<string, unknown> }).client;
const trader = (ex as unknown as {
  trader: { placeOrder: (p: unknown) => Promise<Record<string, unknown>>; redeem: (p: unknown) => Promise<Record<string, unknown>> };
}).trader;

const account = (ex as unknown as { walletAddress?: string }).walletAddress ?? null;

/** Venue grid. Mainnet is 18dp and needs integer conversion; testnet is 6dp. */
const grid = () =>
  NETWORK === "mainnet"
    ? { tick: 1_000_000_000_000_000n, lot: 1_000_000_000_000_000n }
    : { tick: 1_000n, lot: 1n };

const toSteps = (human: number, one: bigint, step: bigint, mode: "round" | "floor") => {
  const per = Number(one / step);
  const n = human * per;
  return BigInt(Math.max(0, mode === "round" ? Math.round(n) : Math.floor(n + 1e-9))) * step;
};

/** A reverted write does NOT throw. The receipt is the only truth. */
const assertTxOk = (res: { hash?: string; receipt?: { status?: string } }, label: string) => {
  if (res?.receipt?.status === "reverted")
    throw new Error(`${label} REVERTED (tx ${res.hash ?? "?"})`);
};

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/** Which windows we have already carried, so a chain is rolled once. */
const carried = new Set<string>();

async function rollTick(): Promise<void> {
  const all = Object.values(await ex.loadMarkets(true)) as Record<string, any>[];
  const now = Math.floor(Date.now() / 1000);

  const chains = new Map<string, Record<string, any>[]>();
  for (const m of all) {
    if (m.type !== "binary") continue;
    const iv = Number(m.info.intervalSec);
    if (iv > MAX_INTERVAL) continue;
    const key = `${m.info.asset}-${iv}`;
    if (CHAINS.length && !CHAINS.includes(key)) continue;
    (chains.get(key) ?? chains.set(key, []).get(key)!).push(m);
  }

  for (const [key, ms] of chains) {
    const sorted = ms.sort((a, b) => Number(a.info.expiry) - Number(b.info.expiry));
    const live = sorted.find((m) => m.active && Number(m.info.expiry) > now);
    if (!live) continue;

    const next = sorted.find((m) => Number(m.info.expiry) > Number(live.info.expiry));
    if (!next) continue;                                   // successor not struck yet — normal
    if (!next.info.strike || next.info.strike === "0") continue;
    if (next.info.status !== "Trading") continue;

    const stamp = `${key}:${next.info.marketId}`;
    if (carried.has(stamp)) continue;                       // already carried into this window

    for (const outcome of ["YES", "NO"] as const) {
      let ask: [number, number] | undefined;
      try {
        const ob = await ex.fetchOrderBook(`${next.symbol}#${outcome}`);
        ask = ((ob.asks ?? []) as [number, number][])[0];
      } catch { /* book unavailable */ }
      if (!ask) continue;

      log(`roll ${key}: successor struck ${Number(next.info.strike) / 100}, ${outcome} ask ${ask[0]}`);
      if (DRY_RUN) { log(`  DRY_RUN — not sending`); carried.add(stamp); break; }

      const oc = (await (client.getMarketOnchain as any)(next.info.marketId)) as Record<string, any>;
      const one = 10n ** BigInt(Number(oc.decimals ?? 6));
      const { tick, lot } = grid();
      const quantity = toSteps(SIZE, one, lot, "floor");
      const priceOwn = toSteps(ask[0], one, tick, "round");
      if (quantity <= 0n || priceOwn <= 0n || priceOwn >= one) break;

      // The book is quoted in YES terms whichever leg you trade.
      const priceYes = outcome === "YES" ? priceOwn : one - priceOwn;
      // Mandatory expiry, capped at the market's own.
      const expiresAt = Math.min(now + 120, Number(oc.expiry));
      if (expiresAt <= now) break;

      try {
        const res = await trader.placeOrder({
          pool: oc.pool,
          side: outcome === "YES" ? "BUY_YES" : "BUY_NO",
          price: priceYes,
          quantity,
          outcomeToken: oc.outcomeToken,
          yesId: oc.yesId,
          noId: oc.noId,
          orderType: ORDER_TYPE.MARKET, // fill now, cancel the rest
          expireTimestampNs: BigInt(expiresAt) * 1_000_000_000n,
        });
        assertTxOk(res as any, `roll ${key}`);
        log(`  ROLLED ${key} -> tx ${res.hash} receipt ${(res as any).receipt?.status}`);
        carried.add(stamp);
      } catch (e) {
        log(`  roll failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`);
      }
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Claim                                                               */
/* ------------------------------------------------------------------ */

let lastClaimAt = 0;

/**
 * Sweep settled markets and redeem anything held.
 *
 * In the loop, not on a timer: it signs from the same key the roll does.
 */
async function claimTick(): Promise<void> {
  if (Date.now() - lastClaimAt < CLAIM_EVERY_MS) return;
  lastClaimAt = Date.now();
  if (!account) return;

  const rows = (await (client.listBinaryMarkets as any)({
    status: "Finalized",
    limit: CLAIM_SCAN,
  })) as Record<string, any>[];

  let claimed = 0;
  for (const row of rows ?? []) {
    const id = row.marketId ?? row.id;
    if (!id) continue;
    const oc = (await (client.getMarketOnchain as any)(id).catch(() => null)) as Record<string, any> | null;
    if (!oc || !(oc.isResolved || oc.isVoided)) continue;

    const bal = async (tokenId: bigint) =>
      (await (client.getOutcomeBalance as any)({
        outcomeToken: oc.outcomeToken,
        account,
        id: tokenId,
      }).catch(() => 0n)) as bigint;

    const [yes, no] = await Promise.all([bal(oc.yesId), bal(oc.noId)]);
    // A VOID pays BOTH sides; a resolution pays only the winner.
    const idxs: number[] = oc.isVoided ? [0, 1] : [Number(oc.winningOutcome)];

    for (const idx of idxs) {
      const held = idx === 0 ? BigInt(yes) : BigInt(no);
      if (held === 0n) continue;
      if (DRY_RUN) { log(`claim: DRY_RUN — would redeem ${held} on ${String(id).slice(0, 12)}…`); continue; }
      try {
        const res = await trader.redeem({
          marketId: id,
          market: oc.marketAddress,
          outcomeToken: oc.outcomeToken,
          outcomeIdx: idx,
          amount: held,
        });
        assertTxOk(res as any, `redeem ${String(id).slice(0, 12)}`);
        log(`claim: redeemed ${held} outcome ${idx} -> tx ${res.hash}`);
        claimed++;
      } catch (e) {
        log(`claim failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
      }
    }
  }
  if (claimed) log(`claim: swept ${claimed} market(s)`);
}

/* ------------------------------------------------------------------ */

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`${sig} — finishing current tick then exiting`);
    stopping = true;
  });
}

log(`PRISM roll runner starting`);
log(`  network=${NETWORK} dryRun=${DRY_RUN} size=${SIZE} tick=${TICK_MS}ms`);
log(`  account=${account ?? "(unknown)"}`);
log(`  chains=${CHAINS.length ? CHAINS.join(",") : `all with interval <= ${MAX_INTERVAL}s`}`);
if (DRY_RUN) log(`  DRY_RUN is on — nothing will be signed. Set PRISM_DRY_RUN=false to arm.`);

while (!stopping) {
  try {
    await rollTick();
    await claimTick();
  } catch (e) {
    // A tick failing is routine: the testnet indexer times out regularly.
    log(`tick error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, TICK_MS));
}

log("stopped cleanly");
