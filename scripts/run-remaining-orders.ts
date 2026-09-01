/**
 * PRISM — place remaining orders (#16-50) after the harvest.
 * Loads the existing proof, skips wallets already in it, places one real
 * BUY_YES order per remaining wallet via HTTP transport.
 *
 * Run:  bun scripts/run-remaining-orders.ts
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
const ONE = 10n ** 6n;
const RPC = "https://api.infra.testnet.somnia.network";
const DELAY_MS = 2500;

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
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "a", type: "uint256" },
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

async function bestAsk(poolAddr: `0x${string}`): Promise<bigint | null> {
  try {
    const asks = (await pub.readContract({
      address: poolAddr,
      abi: BOOK_ABI,
      functionName: "getBookLevels",
      args: [false, 3n],
    })) as unknown as { price: bigint }[];
    return asks.length > 0 ? asks[0].price : null;
  } catch {
    return null;
  }
}

async function main() {
  const proofPath = "/home/arch/somnai-local/tx-proof-50-orders.json";
  let proof: any;
  try {
    proof = JSON.parse(readFileSync(proofPath, "utf8"));
  } catch {
    proof = { network: "Somnia Shannon testnet (50312)", orders: [] };
  }
  if (!proof.orders) proof.orders = [];
  const done = new Set(proof.orders.map((o: any) => o.idx));
  console.log(`loaded ${proof.orders.length} existing orders; placing for ${50 - done.size} remaining`);
  const c: any = ex.client;

  for (const w of WALLETS) {
    if (done.has(w.idx)) { console.log(`  #${w.idx} done — skip`); continue; }
    try {
      const rows = await c.listRegistryMarkets();
      const bin = rows.filter(
        (m: any) => m.marketType === "BINARY" && m.status === "Trading" && m.strike,
      );
      if (bin.length === 0) { console.log(`  #${w.idx} no struck market`); continue; }
      const wc = createWalletClient({
        account: privateKeyToAccount(w.privateKey as Hex),
        chain: somnia,
        transport: http(),
      });

      let placed = false;
      for (let attempt = 0; attempt < 4 && !placed; attempt++) {
        const freshRows = attempt === 0 ? rows : await c.listRegistryMarkets();
        const freshBin = freshRows.filter(
          (mm: any) => mm.marketType === "BINARY" && mm.status === "Trading" && mm.strike,
        );
        if (freshBin.length === 0) continue;
        // Scan forward for the first market with a live ask — many listed
        // markets have empty books; picking by index hits them.
        let picked: any = null, askPrice: bigint | null = null;
        for (let i = 0; i < freshBin.length && !picked; i++) {
          const mm = freshBin[i];
          const asks = await pub.readContract({
            address: mm.poolAddress as `0x${string}`,
            abi: BOOK_ABI,
            functionName: "getBookLevels",
            args: [false, 3n],
          }).catch(() => [] as unknown as { price: bigint }[]);
          if (asks.length > 0) { picked = mm; askPrice = asks[0].price; }
        }
        if (!picked || askPrice === null) { await sleep(1000); continue; }
        const pool = picked.poolAddress as `0x${string}`;

        try {
          const apprTx = await wc.writeContract({
            address: COLLATERAL, abi: ERC20, functionName: "approve",
            args: [pool, 100n * ONE],
          });
          await pub.waitForTransactionReceipt({ hash: apprTx });
        } catch { /* already approved */ }

        try {
          const orderTx = await wc.writeContract({
            address: pool,
            abi: POOL_ABI,
            functionName: "placeBinaryOrder",
            args: [0, askPrice, ONE, BigInt(picked.expiry) * 1_000_000_000n, 2, 0, "0x0000000000000000000000000000000000000000" as `0x${string}`, 0n, 0n],
          });
          const rec = await pub.waitForTransactionReceipt({ hash: orderTx });
          if (rec.status !== "success") { await sleep(800); continue; }
          proof.orders.push({
            idx: w.idx, wallet: w.address, market: picked.symbol ?? null, pool,
            hash: orderTx, orderId: null, fills: rec.logs.length, status: rec.status,
          });
          writeFileSync(proofPath, JSON.stringify(proof, null, 2));
          console.log(`  #${w.idx} ${w.address.slice(0, 12)}… → ${orderTx.slice(0, 18)} success`);
          placed = true;
        } catch { await sleep(800); }
      }
      if (!placed) console.log(`  #${w.idx} all attempts failed`);
    } catch (e: any) {
      console.error(`  #${w.idx} FAIL: ${String(e?.message ?? e).slice(0, 140)}`);
    }
    await sleep(DELAY_MS);
  }

  // verify all
  for (const o of proof.orders) {
    if (o.verified === true) continue;
    try {
      const rec = await pub.getTransactionReceipt({ hash: o.hash as Hex });
      o.verified = rec.status === "success";
      o.block = Number(rec.blockNumber);
      o.from = rec.from;
      o.to = rec.to;
    } catch { o.verified = o.verified ?? null; }
  }
  writeFileSync(proofPath, JSON.stringify(proof, null, 2));
  const good = proof.orders.filter((o: any) => o.verified === true).length;
  console.log(`\nDONE: ${proof.orders.length} orders, ${good} verified`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
