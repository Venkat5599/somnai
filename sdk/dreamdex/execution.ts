import "server-only";

/**
 * The DreamDEX execution adapter.
 *
 * Every protocol interaction that can move funds lives here. React orchestrates
 * state; this module talks to the venue. Nothing below is speculative — the
 * path was proven with a real fill on Shannon:
 *
 *   tx    0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e
 *   block 471425180, receipt status 0x1, tUSDC 500.000000 -> 499.114000
 *
 * THE CENTRAL RULE: the SDK's response is evidence, not truth. The bot-kit
 * documents that a write can resolve without throwing even when the underlying
 * transaction reverted, so `verifyExecution` re-derives the outcome from chain
 * state — receipt status, nonce movement, and the collateral balance delta —
 * and is allowed to answer UNKNOWN. UNKNOWN is never rendered as success.
 */

import { createPublicClient, http, type Hex } from "viem";
import {
  SomniaMarkets,
  SOMNIA_TESTNET_PRICE_FEED,
  SOMNIA_TESTNET_ADDRESSES,
} from "@somnia-chain/markets-sdk";
import { somniaShannon, somniaMainnet } from "@somnia-chain/markets-sdk/chains";
import { COLLATERAL, resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import type { EventMarket, Outcome } from "@sdk/venue/types";
import { headroomSec } from "@sdk/venue/types";
import { placeLimit } from "./place-limit";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type OrderSide = "buy" | "sell";

export interface OrderIntent {
  marketId: string;
  outcome: Outcome;
  side: OrderSide;
  /** Contracts. */
  amount: number;
  /** Probability 0..1. Omitted means cross the book. */
  price?: number;
}

/**
 * Hard server-side ceiling on a single order.
 *
 * The deployed demo signs with a shared burner key, so the Buy control is
 * effectively open to the internet. Without a cap here, one visitor could drain
 * the wallet and every later visitor would meet INSUFFICIENT_COLLATERAL — the
 * demo would break itself.
 *
 * Enforced on the SERVER, after the client's number arrives, because a limit
 * that only exists in an input's `max` attribute is not a limit.
 */
export const MAX_ORDER_CONTRACTS = Number(
  process.env.PRISM_MAX_ORDER_CONTRACTS ?? "2",
);

export type ValidationReason =
  | "DRY_RUN_ENABLED"
  | "NO_SIGNER"
  | "AMOUNT_ABOVE_LIMIT"
  | "MARKET_NOT_FOUND"
  | "MARKET_NOT_ACTIVE"
  | "MARKET_NOT_TRADING"
  | "MARKET_UNSTRUCK"
  | "MARKET_EXPIRED"
  | "WITHIN_EXPIRY_HEADROOM"
  | "AMOUNT_NOT_POSITIVE"
  | "AMOUNT_BELOW_MINIMUM"
  | "PRICE_OUT_OF_RANGE"
  | "NO_BOOK_LIQUIDITY"
  | "INSUFFICIENT_COLLATERAL"
  | "INSUFFICIENT_GAS";

export interface ValidationOk {
  ok: true;
  marketId: string;
  outcome: Outcome;
  /** The venue's outcome reference, e.g. "ETH-…/tUSDC#YES". */
  ref: string;
  /** Price we will actually send. */
  price: number;
  amount: number;
  estimatedCost: number;
}

export interface ValidationFailed {
  ok: false;
  reason: ValidationReason;
  detail: string;
}

export type Validation = ValidationOk | ValidationFailed;

export interface SubmitResult {
  /** What the SDK handed back. Evidence only — never treated as truth. */
  sdkStatus: string | null;
  orderId: string | null;
  txHash: string | null;
  filled: number | null;
  remaining: number | null;
  /** Set when the call threw rather than resolving. */
  threw: string | null;
}

export type VerificationResult =
  | {
      status: "VERIFIED_EXECUTED";
      transactionHash: string;
      blockNumber: number;
      orderId: string | null;
      filled: number | null;
      evidence: string[];
    }
  | { status: "VERIFIED_FAILED"; reason: string; transactionHash: string | null; evidence: string[] }
  | { status: "PENDING"; transactionHash: string | null; evidence: string[] }
  | { status: "UNKNOWN"; reason: string; evidence: string[] };

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

const chainFor = (c: VenueConfig) =>
  c.network === "mainnet" ? somniaMainnet : somniaShannon;

/** Read-only chain client. Used by verification so it never depends on the SDK. */
export function rpc(config: VenueConfig = resolveVenueConfig()) {
  return createPublicClient({
    chain: chainFor(config),
    transport: http(config.rpc),
  });
}

/** Signing exchange. Returns null when no key is configured — never throws. */
export function signingExchange(
  config: VenueConfig = resolveVenueConfig(),
): SomniaMarkets | null {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) return null;

  return new SomniaMarkets({
    chain: chainFor(config),
    indexerUrl: config.indexer,
    wsRpcUrl: config.wsRpc,
    priceFeed: SOMNIA_TESTNET_PRICE_FEED,
    // getMarketOnchain resolves markets through the binary module, so the
    // address book is required for any settlement read.
    addresses: SOMNIA_TESTNET_ADDRESSES,
    privateKey: pk as Hex,
  });
}

const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Signer address, or null when unconfigured. */
export async function signerAddress(
  config: VenueConfig = resolveVenueConfig(),
): Promise<string | null> {
  const ex = signingExchange(config);
  if (!ex) return null;
  try {
    const { privateKeyToAccount } = await import("viem/accounts");
    return privateKeyToAccount(process.env.PRIVATE_KEY as Hex).address;
  } catch {
    return null;
  }
}

/** Collateral + gas balances read straight off chain. */
export async function readBalances(config: VenueConfig = resolveVenueConfig()) {
  const address = await signerAddress(config);
  if (!address) return null;
  const client = rpc(config);

  const [gasWei, collateralRaw] = await Promise.all([
    client.getBalance({ address: address as Hex }),
    client.readContract({
      address: COLLATERAL.address as Hex,
      abi: ERC20_BALANCE_OF,
      functionName: "balanceOf",
      args: [address as Hex],
    }) as Promise<bigint>,
  ]);

  return {
    address,
    gas: Number(gasWei) / 1e18,
    collateral: Number(collateralRaw) / 10 ** COLLATERAL.decimals,
    collateralRaw,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Validate                                                         */
/* ------------------------------------------------------------------ */

const fail = (reason: ValidationReason, detail: string): ValidationFailed => ({
  ok: false,
  reason,
  detail,
});

/**
 * Gate everything BEFORE a signature exists.
 *
 * A rejection here costs nothing; a rejection on-chain costs gas and leaves a
 * failed transaction on the record.
 */
export async function validateOrder(
  intent: OrderIntent,
  market: EventMarket | null,
  book: { bids: [number, number][]; asks: [number, number][] } | null,
  config: VenueConfig = resolveVenueConfig(),
): Promise<Validation> {
  if (config.dryRun)
    return fail("DRY_RUN_ENABLED", "PRISM_DRY_RUN is true. Nothing will be signed or sent.");

  if (!signingExchange(config))
    return fail("NO_SIGNER", "No PRIVATE_KEY configured for this deployment.");

  if (!market || market.marketId !== intent.marketId)
    return fail("MARKET_NOT_FOUND", "That market is not in the current registry.");

  if (!market.active) return fail("MARKET_NOT_ACTIVE", "The venue reports this window closed.");
  if (market.status !== "Trading")
    return fail("MARKET_NOT_TRADING", `On-chain status is ${market.status}; only Trading accepts orders.`);
  if (market.strike === null)
    return fail("MARKET_UNSTRUCK", "The venue has not struck this window yet.");

  const left = market.expiry - Math.floor(Date.now() / 1000);
  if (left <= 0) return fail("MARKET_EXPIRED", "This window has already closed.");

  const need = headroomSec(market.intervalSec);
  if (left <= need)
    return fail(
      "WITHIN_EXPIRY_HEADROOM",
      `${left}s remain; this window requires ${need}s of headroom so an order cannot lock mid-flight.`,
    );

  if (!(intent.amount > 0)) return fail("AMOUNT_NOT_POSITIVE", "Size must be greater than zero.");
  if (intent.amount > MAX_ORDER_CONTRACTS)
    return fail(
      "AMOUNT_ABOVE_LIMIT",
      `This deployment caps a single order at ${MAX_ORDER_CONTRACTS} contracts; it signs with a shared demo wallet.`,
    );
  if (intent.amount < market.minAmount)
    return fail("AMOUNT_BELOW_MINIMUM", `Venue minimum is ${market.minAmount} contracts.`);

  // Price: use the given one, else cross the book.
  let price = intent.price;
  if (price === undefined) {
    const level = intent.side === "buy" ? book?.asks?.[0] : book?.bids?.[0];
    if (!level) return fail("NO_BOOK_LIQUIDITY", "No resting size on the side this order must cross.");
    price = level[0];
  }
  if (!(price > 0 && price < 1))
    return fail("PRICE_OUT_OF_RANGE", "A binary price is a probability strictly between 0 and 1.");

  const estimatedCost = intent.side === "buy" ? intent.amount * price : 0;

  const bal = await readBalances(config);
  if (bal) {
    if (bal.gas <= 0) return fail("INSUFFICIENT_GAS", "No STT to pay gas.");
    if (intent.side === "buy" && bal.collateral < estimatedCost)
      return fail(
        "INSUFFICIENT_COLLATERAL",
        `Needs ${estimatedCost.toFixed(6)} ${COLLATERAL.symbol}, wallet holds ${bal.collateral.toFixed(6)}.`,
      );
  }

  // The venue addresses an outcome by symbol suffix, so the index is redundant.
  const ref = `${market.symbol}#${intent.outcome}`;

  return {
    ok: true,
    marketId: market.marketId,
    outcome: intent.outcome,
    ref,
    price: Number(price.toFixed(market.pricePrecision)),
    amount: intent.amount,
    estimatedCost,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Submit                                                           */
/* ------------------------------------------------------------------ */

/**
 * Send the order. IOC by default so no resting size is left behind with escrow
 * locked — the bot-kit calls an unfilled remainder the easiest way to lose
 * track of collateral.
 *
 * Never throws: a thrown SDK call is itself evidence the verifier must weigh,
 * because the transaction may still have been mined.
 */
export async function submitOrder(
  v: ValidationOk,
  side: OrderSide,
  config: VenueConfig = resolveVenueConfig(),
): Promise<SubmitResult> {
  const ex = signingExchange(config);
  if (!ex)
    return { sdkStatus: null, orderId: null, txHash: null, filled: null, remaining: null, threw: "NO_SIGNER" };

  let rawFallbackReason: string | null = null;

  try {
    // Grid-safe path FIRST. createOrder hands a float to parseUnits, which is
    // safe at 6 decimals and broken at 18 — so the unified tier would pass every
    // testnet test and fail on mainnet. placeLimit converts in tick and lot
    // units as exact integers instead.
    try {
      const placed = await placeLimit(
        {
          marketId: v.marketId,
          outcome: v.outcome,
          side,
          price: v.price,
          size: v.amount,
          type: "ioc",
        },
        config,
      );
      if (placed.hash || placed.filled > 0) {
        return {
          sdkStatus: placed.rested ? "open" : "closed",
          orderId: placed.orderId,
          txHash: placed.hash,
          filled: placed.filled,
          remaining: placed.size - placed.filled,
          threw: null,
        };
      }
    } catch (rawErr) {
      // Fall through to the unified tier, but keep the reason: on a 6-decimal
      // venue it will very likely succeed, and silently swallowing why the
      // grid-safe path declined would hide a real mainnet defect.
      rawFallbackReason =
        rawErr instanceof Error ? rawErr.message.slice(0, 160) : String(rawErr);
    }

    const order = await ex.createOrder(v.ref, "limit", side, v.amount, v.price, {
      timeInForce: "IOC",
    });
    const info = (order as { info?: Record<string, unknown> }).info ?? {};
    const hash =
      order.txHash ??
      (typeof info.hash === "string" ? info.hash : null) ??
      null;

    return {
      sdkStatus: order.status ?? null,
      orderId: order.id ?? null,
      txHash: hash,
      filled: order.filled ?? null,
      remaining: order.remaining ?? null,
      threw: rawFallbackReason ? `grid-safe path declined: ${rawFallbackReason}` : null,
    };
  } catch (e) {
    return {
      sdkStatus: null,
      orderId: null,
      txHash: null,
      filled: null,
      remaining: null,
      threw: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ------------------------------------------------------------------ */
/* 3. Verify — the part that decides the truth                         */
/* ------------------------------------------------------------------ */

/**
 * Re-derive the outcome from chain state.
 *
 * Deliberately does NOT read the SDK's status field. Evidence considered:
 *   - receipt.status on the transaction hash (authoritative when present)
 *   - collateral balance delta across the attempt
 *   - nonce movement, which proves a transaction was broadcast at all
 *
 * Returns UNKNOWN rather than guessing. A caller must never render UNKNOWN as
 * success.
 */
export async function verifyExecution(
  submit: SubmitResult,
  before: { collateralRaw: bigint; nonce: number } | null,
  config: VenueConfig = resolveVenueConfig(),
): Promise<VerificationResult> {
  const evidence: string[] = [];
  const client = rpc(config);
  const address = await signerAddress(config);

  if (submit.threw) evidence.push(`sdk threw: ${submit.threw.slice(0, 140)}`);
  if (submit.sdkStatus) evidence.push(`sdk status: ${submit.sdkStatus} (not trusted)`);

  // --- Strongest evidence: the receipt itself.
  if (submit.txHash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: submit.txHash as Hex });
      evidence.push(`receipt.status=${receipt.status} block=${receipt.blockNumber}`);

      if (receipt.status === "success") {
        return {
          status: "VERIFIED_EXECUTED",
          transactionHash: submit.txHash,
          blockNumber: Number(receipt.blockNumber),
          orderId: submit.orderId,
          filled: submit.filled,
          evidence,
        };
      }
      return {
        status: "VERIFIED_FAILED",
        reason: "Transaction mined but reverted (receipt.status = reverted).",
        transactionHash: submit.txHash,
        evidence,
      };
    } catch {
      evidence.push("receipt not yet available for that hash");
      return { status: "PENDING", transactionHash: submit.txHash, evidence };
    }
  }

  // --- No hash. Did anything reach the chain at all?
  if (address && before) {
    try {
      const nonce = await client.getTransactionCount({ address: address as Hex });
      evidence.push(`nonce ${before.nonce} -> ${nonce}`);

      const nowRaw = (await client.readContract({
        address: COLLATERAL.address as Hex,
        abi: ERC20_BALANCE_OF,
        functionName: "balanceOf",
        args: [address as Hex],
      })) as bigint;

      const delta = Number(nowRaw - before.collateralRaw) / 10 ** COLLATERAL.decimals;
      evidence.push(`${COLLATERAL.symbol} delta ${delta.toFixed(6)}`);

      if (nonce > before.nonce) {
        // Something was broadcast, but without a hash we cannot name it. That
        // is precisely the UNKNOWN case, and it must not read as success.
        return {
          status: "UNKNOWN",
          reason:
            "A transaction was broadcast (nonce advanced) but the SDK returned no hash, so the result cannot be attributed.",
          evidence,
        };
      }

      return {
        status: "VERIFIED_FAILED",
        reason: "Nothing was broadcast: nonce did not move and no hash was returned.",
        transactionHash: null,
        evidence,
      };
    } catch (e) {
      evidence.push(`chain read failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    }
  }

  return {
    status: "UNKNOWN",
    reason: "No transaction hash and no usable chain evidence.",
    evidence,
  };
}

/** Snapshot taken immediately before submitting, so deltas mean something. */
export async function preflightSnapshot(config: VenueConfig = resolveVenueConfig()) {
  const address = await signerAddress(config);
  if (!address) return null;
  const client = rpc(config);
  const [nonce, collateralRaw] = await Promise.all([
    client.getTransactionCount({ address: address as Hex }),
    client.readContract({
      address: COLLATERAL.address as Hex,
      abi: ERC20_BALANCE_OF,
      functionName: "balanceOf",
      args: [address as Hex],
    }) as Promise<bigint>,
  ]);
  return { nonce, collateralRaw };
}

/** Explorer URL for a hash. Only ever called with a hash from real evidence. */
export const explorerTx = (hash: string, config: VenueConfig = resolveVenueConfig()) =>
  `${config.explorer}/tx/${hash}`;
