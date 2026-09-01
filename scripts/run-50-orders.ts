/**
 * PRISM 50-account proof run — one real BUY_YES order per wallet, on live
 * Somnia Shannon markets, all routed to the venue's order-pool contract.
 *
 *   Phase A (fund): wallet #1 distributes ~10 tUSDC + ~0.1 STT gas to the
 *                   other 49 cohort wallets (skips wallets already funded).
 *   Phase B (execute): each wallet approves tUSDC and places one real IOC
 *                      BUY_YES order via placeBinaryOrder (HTTP transport).
 *   Phase C (verify): every receipt re-read from chain; proof written to
 *                     /home/arch/somnai-local/tx-proof-50-orders.json
 *
 * RATE-LIMIT NOTES (learned live on Shannon):
 *   The venue's public indexer throttles after ~15-20 rapid listRegistryMarkets
 *   calls, and the WS endpoint rejects writes with data 0x03. This runner:
 *     - sends ALL writes through a plain viem HTTP walletClient (not the SDK
 *       trader, which uses the WS transport)
 *     - reads the book with a raw getBookLevels eth_call over HTTP
 *     - reuses a cached market list for 3 wallets, then refreshes
 *     - delays 3s per wallet, and pauses 30s every 8 wallets
 *
 * Reads keys from /home/arch/somnai-local/somnia-50-wallets.json (chmod 600).
 * Run with bun from the repo root:  bun scripts/run-50-orders.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { createPublicClient, createWalletClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  SomniaMarkets,
  SOMNIA_TESTNET_PRICE_FEED,
  SOMNIA_TESTNET_ADDRESSES,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const WALLETS = JSON.parse(
  readFileSync("/home/arch/somnai-local/somnia-50-wallets.json", "utf8"),
) as { idx: number; address: string; privateKey: string }[];

const COLLATERAL = "0x70a86d8842fb63c4ad2b7cdddf530ebf1bb25d8e" as const;
const DECIMALS = 6n;
const ONE = 10n ** DECIMALS;
const TUSDC_PER_WALLET = 10n * ONE; // 10 tUSDC escrow per wallet
const STT_GAS_PER_WALLET = 100000000000000000n; // 0.1 STT gas per wallet
const RPC = "https://api.infra.testnet.somnia.network";
const WALLET_DELAY_MS = 3000;
const PAUSE_EVERY = 8;
const PAUSE_MS = 30000;
const MARKET_REFRESH_EVERY = 3;

const somnia = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "Somnia Tokens", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const pub = createPublicClient({ chain: somnia, transport: http() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ERC20 = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "a", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const POOL_ABI = [
  {
    name: "placeBinaryOrder",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "kind", type: "uint8" },
      { name: "price", type: "uint256" },
      { name: "quantity", type: "uint256" },
      { name: "expireTimestampNs", type: "uint64" },
      { name: "orderType", type: "uint8" },
      { name: "selfMatchingOption", type: "uint8" },
      { name: "builder", type: "address" },
      { name: "builderFeeBpsTimes1k", type: "uint96" },
      { name: "userData", type: "uint64" },
    ],
    outputs: [
      { name: "success", type: "bool" },
      { name: "id", type: "uint128" },
    ],
  },
] as const;

const BOOK_ABI = [
  {
    name: "getBookLevels",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "isBid", type: "bool" },
      { name: "numLevels", type: "uint64" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "price", type: "uint256" },
          { name: "quantity", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const ex = new SomniaMarkets({
  chain: somniaShannon,
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  addresses: SOMNIA_TESTNET_ADDRESSES,
  privateKey: WALLETS[0].privateKey as Hex,
});

/** Best ask (raw price) for a pool via a plain HTTP eth_call. */
async function bestAsk(poolAddr: `0x${string}`): Promise<bigint | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const asks = (await pub.readContract({
        address: poolAddr,
        abi: BOOK_ABI,
        functionName: "getBookLevels",
        args: [false, 3n],
      })) as unknown as { price: bigint }[];
      if (asks.length > 0) return asks[0].price;
    } catch {
      // transient — retry
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  const proof: any = {
    network: "Somnia Shannon testnet (50312)",
    contract: { orderPool: "0x645b9b09b085326afa00efd9daf5c61f8401a694", collateral: COLLATERAL },
    funding: [] as any[],
    orders: [] as any[],
  };

  // ---------------- Phase A: fund the empty wallets ----------------
  const funderAcct = privateKeyToAccount(WALLETS[0].privateKey as Hex);
  const funder = createWalletClient({ account: funderAcct, chain: somnia, transport: http() });
  console.log("Phase A: funding wallets 2-50 from", WALLETS[0].address);
  for (let i = 1; i < WALLETS.length; i++) {
    const w = WALLETS[i];
    const g = await pub.getBalance({ address: w.address as Hex });
    if (Number(g) / 1e18 >= 0.05) {
      console.log(`  #${w.idx} already has gas — skip`);
      continue;
    }
    try {
      const tusdcTx = await funder.writeContract({
        address: COLLATERAL,
        abi: ERC20,
        functionName: "transfer",
        args: [w.address as Hex, TUSDC_PER_WALLET],
      });
      await pub.waitForTransactionReceipt({ hash: tusdcTx });
      const sttTx = await funder.sendTransaction({ to: w.address as Hex, value: STT_GAS_PER_WALLET });
      await pub.waitForTransactionReceipt({ hash: sttTx });
      proof.funding.push({ idx: w.idx, address: w.address, tusdcTx, sttTx });
      console.log(`  #${w.idx} ${w.address.slice(0, 12)}… tUSDC=${tusdcTx.slice(0, 12)} STT=${sttTx.slice(0, 12)}`);
    } catch (e: any) {
      console.error(`  #${w.idx} FUND FAILED: ${String(e?.message ?? e).slice(0, 160)}`);
    }
    writeFileSync("/home/arch/somnai-local/tx-proof-50-orders.json", JSON.stringify(proof, null, 2));
    await sleep(500);
  }

  // ---------------- Phase B: one real order per wallet ----------------
  console.log("\nPhase B: 50 wallets → order pool");
  const c: any = ex.client;
  const doneIdx = new Set(proof.orders.map((o: any) => o.idx));
  let marketCache: any[] | null = null;
  let cacheCount = 0;
  for (const w of WALLETS) {
    if (doneIdx.has(w.idx)) { console.log(`  #${w.idx} already ordered — skip`); continue; }
    try {
      // Refresh market list every few wallets (rate-limit friendly)
      if (!marketCache || cacheCount % MARKET_REFRESH_EVERY === 0) {
        marketCache = await c.listRegistryMarkets();
        cacheCount = 0;
      }
      cacheCount++;
      const bin = (marketCache ?? []).filter(
        (m: any) => m.marketType === "BINARY" && m.status === "Trading" && m.strike,
      );
      if (bin.length === 0) { console.log(`  #${w.idx} no trading struck market`); continue; }
      const wc = createWalletClient({
        account: privateKeyToAccount(w.privateKey as Hex),
        chain: somnia,
        transport: http(),
      });

      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        // refresh cache on later attempts (windows expire ~60s)
        if (attempt >= 2) {
          marketCache = await c.listRegistryMarkets();
          cacheCount = 0;
        }
        const freshBin = (marketCache ?? []).filter(
          (mm: any) => mm.marketType === "BINARY" && mm.status === "Trading" && mm.strike,
        );
        const mm = freshBin[(w.idx + attempt * 11) % freshBin.length];
        if (!mm) continue;
        const freshPool = mm.poolAddress as `0x${string}`;
        const askPrice = await bestAsk(freshPool);
        if (askPrice === null) { await sleep(1000); continue; }

        try {
          const apprTx = await wc.writeContract({
            address: COLLATERAL, abi: ERC20, functionName: "approve",
            args: [freshPool, 100n * ONE],
          });
          await pub.waitForTransactionReceipt({ hash: apprTx });
        } catch {
          // already approved / transient — proceed
        }

        try {
          const orderTx = await wc.writeContract({
            address: freshPool,
            abi: POOL_ABI,
            functionName: "placeBinaryOrder",
            args: [0, askPrice, ONE, BigInt(mm.expiry) * 1_000_000_000n, 2, 0, "0x0000000000000000000000000000000000000000" as `0x${string}`, 0n, 0n],
          });
          const rec = await pub.waitForTransactionReceipt({ hash: orderTx });
          if (rec.status !== "success") { await sleep(1000); continue; }
          proof.orders.push({
            idx: w.idx, wallet: w.address, market: mm.symbol ?? null, pool: freshPool,
            hash: orderTx, orderId: null, fills: rec.logs.length, status: rec.status,
          });
          console.log(`  #${w.idx} ${w.address.slice(0, 12)}… ${mm.symbol ?? "?"} → ${orderTx.slice(0, 18)} status=${rec.status}`);
          placed = true;
        } catch {
          await sleep(1000);
        }
      }
      if (!placed) console.log(`  #${w.idx} all attempts failed`);
    } catch (e: any) {
      console.error(`  #${w.idx} ORDER FAILED: ${String(e?.message ?? e).slice(0, 200)}`);
    }
    writeFileSync("/home/arch/somnai-local/tx-proof-50-orders.json", JSON.stringify(proof, null, 2));

    // Rate-limit pause every N wallets
    if ((w.idx % PAUSE_EVERY) === 0) {
      console.log(`  ...pausing ${PAUSE_MS / 1000}s (rate limit)...`);
      await sleep(PAUSE_MS);
    } else {
      await sleep(WALLET_DELAY_MS);
    }
  }

  // ---------------- Phase C: verify every receipt ----------------
  console.log("\nPhase C: verify receipts");
  for (const o of proof.orders) {
    try {
      const rec = await pub.getTransactionReceipt({ hash: o.hash as Hex });
      o.verified = rec.status === "success";
      o.block = Number(rec.blockNumber);
      o.from = rec.from;
      o.to = rec.to;
    } catch {
      o.verified = null;
    }
  }
  writeFileSync("/home/arch/somnai-local/tx-proof-50-orders.json", JSON.stringify(proof, null, 2));
  const good = proof.orders.filter((o: any) => o.verified === true).length;
  console.log(`\nDONE: ${proof.orders.length} orders, ${good} verified. → /home/arch/somnai-local/tx-proof-50-orders.json`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
