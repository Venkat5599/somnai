import "server-only";

/**
 * Build an order the USER signs.
 *
 * This is the non-custodial path, and it is what actually lifts the throughput
 * ceiling. The burner path signs server-side from one key, so every trade in
 * the system contends for one sequential nonce — roughly one transaction
 * globally, no matter how much compute is thrown at it. When the user signs
 * from their own address there is no shared nonce and no ceiling.
 *
 * The split of responsibility is the important part:
 *
 *   SERVER  owns the arithmetic. Price and size are snapped to the venue's
 *           integer tick and lot grid here, so the client never hands a float
 *           to an 18-decimal venue. That bug is invisible on a 6-decimal
 *           testnet and fatal on mainnet, and it must not depend on the
 *           browser getting it right.
 *
 *   CLIENT  owns the key. It receives `to`, `data`, `value` and signs. No
 *           private material is ever sent to the browser, and none is held for
 *           the user on the server.
 *
 * APPROVAL IS RETURNED, NOT SENT. The SDK is explicit that a caller who skips a
 * needed approval gets an on-chain revert, so it is surfaced as its own call for
 * the client to send first.
 */

import type { Hex } from "viem";
import { resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { headroomSec, type EventMarket, type Outcome } from "@sdk/venue/types";
import { exchange } from "@sdk/venue/markets";
import { ORDER_TYPE } from "@somnia-chain/markets-sdk";
import { gridFor, toSteps } from "./grid";
import { builderExchange } from "./markets-builder";

export interface UnsignedCallDTO {
  to: string;
  data: string;
  /** Stringified: bigint does not survive the server/client boundary. */
  value: string;
  description: string;
}

export type PrepareResult =
  | {
      ok: true;
      /** Send FIRST when present, or the order reverts. */
      approval: UnsignedCallDTO | null;
      order: UnsignedCallDTO;
      chainId: number;
      /** What the user is agreeing to, in human units. */
      quote: { price: number; size: number; cost: number; outcome: Outcome };
    }
  | { ok: false; reason: string; detail: string };

/**
 * Prepare one order for client-side signing.
 *
 * Validation still happens here rather than in the browser: a rejection costs
 * nothing, while an invalid order that reaches the chain costs the user gas.
 */
export async function prepareOrder(
  args: {
    marketId: string;
    outcome: Outcome;
    side: "buy" | "sell";
    amount: number;
    /** Probability in (0,1). Omitted crosses the book. */
    price?: number;
    /**
     * Which side of the trade the user is on.
     *
     * "taker" crosses a resting offer and needs one to exist. "post-only" ADDS
     * the offer — it is refused by the venue if it would cross — so it needs no
     * counterparty and is the only thing that can be done on an empty book.
     *
     * Both build through the SAME arithmetic below. A separate builder for the
     * making path would be a second place for the tick-grid conversion to be
     * got wrong, and that conversion is the bug this file exists to prevent.
     */
    type?: "taker" | "post-only";
    /**
     * The wallet that will sign. Required: the SDK's builder tier is gated
     * behind an account, and the approval it encodes is owner-specific.
     */
    owner: string;
  },
  market: EventMarket | null,
  config: VenueConfig = resolveVenueConfig(),
): Promise<PrepareResult> {
  if (!market || market.marketId !== args.marketId)
    return { ok: false, reason: "MARKET_NOT_FOUND", detail: "That market is not in the registry." };
  if (market.strike === null)
    return { ok: false, reason: "MARKET_UNSTRUCK", detail: "The venue has not struck this window yet." };
  if (market.status !== "Trading")
    return { ok: false, reason: "MARKET_NOT_TRADING", detail: `Status is ${market.status}.` };

  const maker = args.type === "post-only";

  const left = market.expiry - Math.floor(Date.now() / 1000);
  // A RESTING ORDER NEEDS MORE ROOM THAN A CROSSING ONE. The venue rejects a
  // post-only order aimed into a close with OrderAlreadyExpired() — a verdict
  // about the market, not the order, reproduced on chain and written up as
  // edge 9 in docs/gotchas.md. A taker never meets it, because an IOC order is
  // gone either way.
  const need = maker
    ? Math.max(headroomSec(market.intervalSec), 60)
    : headroomSec(market.intervalSec);
  if (left <= 0)
    return { ok: false, reason: "MARKET_EXPIRED", detail: "This window has closed." };
  if (left <= need)
    return {
      ok: false,
      reason: "WITHIN_EXPIRY_HEADROOM",
      detail: `${left}s remain; this window needs ${need}s so an order cannot lock mid-flight.`,
    };
  if (!(args.amount > 0) || args.amount < market.minAmount)
    return {
      ok: false,
      reason: "AMOUNT_BELOW_MINIMUM",
      detail: `Venue minimum is ${market.minAmount} contracts.`,
    };

  const ex = exchange(config);

  // Price against the real book when the caller did not name one. A maker
  // NAMES its price by definition — that is the whole point — so it never falls
  // back to the book, and an absent price is a caller bug rather than an empty
  // book.
  let price = args.price;
  if (price === undefined && !maker) {
    try {
      const ob = await ex.fetchOrderBook(`${market.symbol}#${args.outcome}`);
      price = ((ob.asks ?? []) as [number, number][])[0]?.[0];
    } catch {
      price = undefined;
    }
  }
  if (price === undefined)
    return maker
      ? { ok: false, reason: "PRICE_REQUIRED", detail: "A resting bid has to name its own price." }
      : { ok: false, reason: "NO_BOOK_LIQUIDITY", detail: "Nothing is resting on this outcome." };

  const client = (ex as unknown as { client: Record<string, unknown> }).client;
  const oc = (await (
    client.getMarketOnchain as unknown as (id: Hex) => Promise<Record<string, unknown>>
  )(market.marketId as Hex)) as Record<string, unknown>;

  const decimals = Number(oc.decimals ?? 6);
  const one = 10n ** BigInt(decimals);
  // Ask the venue for its grid; the per-network default is only a fallback.
  let tick: bigint, lot: bigint;
  try {
    const p = (await (
      client.getBinaryBookParams as unknown as (p: string) => Promise<Record<string, unknown>>
    )(String(oc.pool))) as Record<string, unknown>;
    tick = BigInt(String(p.tickSize));
    lot = BigInt(String(p.lotSize));
    if (!(tick > 0n && lot > 0n)) throw new Error("bad grid");
  } catch {
    ({ tick, lot } = gridFor(config.network));
  }

  // The grid conversion lives HERE, not in the browser.
  const quantity = toSteps(args.amount, one, lot, "floor");
  const priceOwn = toSteps(price, one, tick, "round");
  if (quantity <= 0n)
    return { ok: false, reason: "AMOUNT_BELOW_MINIMUM", detail: "Size rounds to zero on the lot grid." };
  if (priceOwn <= 0n || priceOwn >= one)
    return { ok: false, reason: "PRICE_OUT_OF_RANGE", detail: "Price falls outside (0,1) on the tick grid." };

  // The book quotes in YES terms whichever leg is traded.
  const priceYes = args.outcome === "YES" ? priceOwn : one - priceOwn;
  // A taker's order should not outlive the click. A resting one is MEANT to
  // sit, so it lives until just before the window closes and the venue cancels
  // it there — nothing is left locked past the window it belongs to.
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(nowSec + (maker ? Math.max(30, left - 5) : 120), Number(oc.expiry));

  // Read through the read-only client above; BUILD through one bound to the
  // user's address. Neither can sign — see markets-builder.ts.
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.owner))
    return { ok: false, reason: "BUILD_FAILED", detail: "No connected wallet address was supplied." };

  const trader = (builderExchange(args.owner, config) as unknown as {
    trader: { buildPlaceOrder: (p: unknown) => Promise<Record<string, unknown>> };
  }).trader;

  try {
    const built = await trader.buildPlaceOrder({
      pool: oc.pool,
      side: args.outcome === "YES" ? "BUY_YES" : "BUY_NO",
      price: priceYes,
      quantity,
      outcomeToken: oc.outcomeToken,
      yesId: oc.yesId,
      noId: oc.noId,
      // MARKET fills now and cancels the rest, so no escrow is left locked.
      // POST_ONLY is refused by the venue if it would cross, which is what
      // makes it a maker order rather than a limit order that might take.
      orderType: maker ? ORDER_TYPE.POST_ONLY : ORDER_TYPE.MARKET,
      expireTimestampNs: BigInt(expiresAt) * 1_000_000_000n,
    });

    const dto = (c: Record<string, unknown>): UnsignedCallDTO => ({
      to: String(c.to),
      data: String(c.data),
      value: String(c.value ?? 0n),
      description: String(c.description ?? ""),
    });

    const order = built.order as Record<string, unknown> | undefined;
    if (!order) return { ok: false, reason: "BUILD_FAILED", detail: "SDK returned no order call." };

    return {
      ok: true,
      approval: built.approval ? dto(built.approval as Record<string, unknown>) : null,
      order: dto(order),
      chainId: config.chainId,
      quote: {
        price: Number(priceOwn) / Number(one),
        size: Number(quantity) / Number(one),
        cost: (Number(priceOwn) / Number(one)) * (Number(quantity) / Number(one)),
        outcome: args.outcome,
      },
    };
  } catch (e) {
    return {
      ok: false,
      reason: "BUILD_FAILED",
      detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
    };
  }
}
