import "server-only";

/**
 * Order placement that survives an 18-decimal venue.
 *
 * The unified `exchange.createOrder` converts a human price with
 * `parseUnits(price.toFixed(decimals), decimals)`. At 18 decimals that exposes
 * the float's binary representation: `(0.05).toFixed(18)` is
 * "0.050000000000000003" — three wei off the tick grid, which the pool rejects
 * with `InvalidPrice`. The bot-kit measured it on mainnet: of fifteen ordinary
 * probabilities only 0.25, 0.5 and 0.75 survive, the ones binary floating point
 * represents exactly.
 *
 * A 6-decimal venue never shows this, which is exactly why Shannon testnet is
 * clean and mainnet is not. PRISM's first real fill went through `createOrder`
 * without complaint — and would have broken the moment it pointed at mainnet.
 *
 * So no float ever reaches the SDK here. Price and size are converted in TICK
 * and LOT units — small integers, where a single `Math.round` absorbs the
 * epsilon — and sent through the raw trader tier as exact bigints.
 */

import type { Hex } from "viem";
import { signingExchange } from "./execution";
import { resolveVenueConfig, type VenueConfig } from "@/lib/venue/config";
import type { Outcome } from "@/lib/venue/types";
import { gridFor, toSteps } from "./grid";

export { gridFor, toSteps };

const SIDES: Record<string, string> = {
  "YES-buy": "BUY_YES",
  "YES-sell": "SELL_YES",
  "NO-buy": "BUY_NO",
  "NO-sell": "SELL_NO",
};

const ORDER_TYPE_POST_ONLY = 1;
const ORDER_TYPE_MARKET = 2;
const ORDER_TYPE_LIMIT = 0;

/** A reverted write does NOT throw — the receipt has to be checked explicitly. */
export function assertTxOk(
  res: { hash?: string; receipt?: { status?: string } },
  label = "transaction",
): void {
  if (res?.receipt?.status === "reverted") {
    throw new Error(
      `${label} REVERTED on-chain (tx ${res.hash ?? "?"}) — the SDK does not throw on a reverted receipt.`,
    );
  }
}

export interface PlaceLimitResult {
  hash: string | null;
  orderId: string | null;
  /** Contracts filled in this transaction. */
  filled: number;
  /** Contracts requested after lot snapping. */
  size: number;
  /** Price actually sent, after tick snapping. */
  price: number;
  rested: boolean;
}

/**
 * Place one order through the raw tier, on the venue's integer grid.
 *
 * Requires the on-chain market snapshot: the pool, outcome token, and token ids
 * come from chain rather than from an indexed row, because a pool is recycled
 * across windows and an indexed address can be a different market's.
 */
export async function placeLimit(
  args: {
    marketId: string;
    outcome: Outcome;
    side: "buy" | "sell";
    /** Probability in (0,1), in this outcome's own terms. */
    price: number;
    /** Contracts. */
    size: number;
    type?: "post-only" | "ioc" | "limit";
    expiresInSec?: number;
  },
  config: VenueConfig = resolveVenueConfig(),
): Promise<PlaceLimitResult> {
  const ex = signingExchange(config);
  if (!ex) throw new Error("no signer configured");

  const client = (ex as unknown as { client: Record<string, unknown> }).client;
  const onchain = (await (
    client.getMarketOnchain as unknown as (id: Hex) => Promise<Record<string, unknown>>
  )(args.marketId as Hex)) as Record<string, unknown>;

  const decimals = Number(onchain.decimals ?? 6);
  const one = 10n ** BigInt(decimals);
  const { tick, lot } = gridFor(config.network);

  const quantity = toSteps(args.size, one, lot, "floor");
  const priceOwn = toSteps(args.price, one, tick, "round");

  if (quantity <= 0n)
    return { hash: null, orderId: null, filled: 0, size: 0, price: 0, rested: false };
  if (priceOwn <= 0n || priceOwn >= one)
    throw new Error(
      `price ${args.price} falls outside (0,1) once snapped to the tick grid`,
    );

  // The book is quoted in YES terms whichever leg you trade, so a NO order's
  // price is the complement. Integer subtraction, so it stays exactly on grid.
  const priceYes = args.outcome === "YES" ? priceOwn : one - priceOwn;

  // Mandatory expiry, capped at the market's own — the venue rejects anything
  // later, and an un-expiring order outlives a crashed process.
  const nowSec = Math.floor(Date.now() / 1000);
  const wanted = nowSec + (args.expiresInSec ?? 300);
  const expiresAt = Math.min(wanted, Number(onchain.expiry));
  if (expiresAt <= nowSec)
    return { hash: null, orderId: null, filled: 0, size: 0, price: 0, rested: false };

  const type = args.type ?? "ioc";
  const trader = (ex as unknown as {
    trader: { placeOrder: (p: unknown) => Promise<Record<string, unknown>> };
  }).trader;

  const res = await trader.placeOrder({
    pool: onchain.pool,
    side: SIDES[`${args.outcome}-${args.side}`],
    price: priceYes,
    quantity,
    outcomeToken: onchain.outcomeToken,
    yesId: onchain.yesId,
    noId: onchain.noId,
    orderType:
      type === "post-only"
        ? ORDER_TYPE_POST_ONLY
        : type === "ioc"
          ? ORDER_TYPE_MARKET
          : ORDER_TYPE_LIMIT,
    expireTimestampNs: BigInt(expiresAt) * 1_000_000_000n,
  });

  assertTxOk(
    res as { hash?: string; receipt?: { status?: string } },
    `${SIDES[`${args.outcome}-${args.side}`]} ${args.marketId.slice(0, 10)}`,
  );

  const fills = (res.fills ?? []) as { quantityFilled?: bigint }[];
  const filledRaw = fills.reduce((acc, f) => acc + BigInt(f.quantityFilled ?? 0n), 0n);
  const orderId = res.orderId != null ? String(res.orderId) : null;

  return {
    hash: typeof res.hash === "string" ? res.hash : null,
    orderId,
    filled: Number(filledRaw) / Number(one),
    size: Number(quantity) / Number(one),
    price: Number(priceOwn) / Number(one),
    rested: orderId !== null && filledRaw < quantity,
  };
}
