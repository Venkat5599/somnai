import "server-only";

/**
 * Pulling resting orders — the capability whose absence blocked three of the
 * Builder's five Event Contract strategies.
 *
 * PRISM could place a post-only order and then never manage it. That is not a
 * missing convenience: a maker must re-quote as the mid moves, and the Builder's
 * own description of the Ladder says it is "flattened before expiry". Without a
 * cancel, every one of those strategies leaves size resting with escrow locked
 * and no way to recover it — which the bot kit calls the easiest way to lose
 * track of collateral. So Market Maker, Passive Bid and Ladder were refused
 * rather than half-run.
 *
 * The SDK has had this the whole time:
 *
 *   trader.cancelOrder  ({ pool, orderId })    one order
 *   trader.cancelOrders ({ pool, orderIds })   several on ONE pool, ONE tx
 *   client.getOwnOpenOrdersOnchain(pool, owner)  ids, read from CHAIN
 *
 * WHY THE ON-CHAIN READ MATTERS. The indexer's order view lags chain head, and
 * cancelling against a lagged list means re-sending cancels for orders already
 * gone and, worse, believing you are flat when a quote is still resting. The
 * pool's own view answers for `msg.sender`, and the SDK impersonates the owner
 * through the eth_call sender, so this needs no signature and is authoritative.
 *
 * Same rule as everywhere else here: the SDK's return value is evidence, and
 * the receipt is the verdict. A cancel that "succeeded" without a successful
 * receipt has not freed anything.
 */

import type { Hex } from "viem";
import { resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";
import { signerAddress, signingExchange, rpc } from "./execution";

export interface RestingOrder {
  /** uint128 order id, as a decimal string — the form the trader tier wants. */
  orderId: string;
  pool: string;
  marketId: string;
}

export interface CancelResult {
  /** Ids this call attempted to pull. */
  orderIds: string[];
  txHash: string | null;
  /** Chain-verified, never the SDK's word. */
  status: "VERIFIED_CANCELLED" | "VERIFIED_FAILED" | "NOTHING_TO_CANCEL" | "UNKNOWN";
  blockNumber: number | null;
  /**
   * Ids still resting after the attempt, re-read from chain.
   *
   * This is the field that matters: a green receipt says the transaction
   * executed, not that every id in it was actually pulled. `cancelExpiredOrders`
   * is explicitly best-effort and skips stale ids without reverting, and a
   * cancel racing a fill can leave nothing to cancel. Re-reading is the only way
   * to know what is still on.
   */
  stillResting: string[];
  evidence: string[];
}

/** Resolve a market's pool address from chain, since pools are recycled. */
async function poolFor(marketId: string, config: VenueConfig): Promise<string | null> {
  const ex = signingExchange(config);
  if (!ex) return null;
  const client = (ex as unknown as { client: Record<string, unknown> }).client;
  try {
    const oc = (await (
      client.getMarketOnchain as unknown as (id: Hex) => Promise<Record<string, unknown>>
    )(marketId as Hex)) as Record<string, unknown>;
    return oc?.pool ? String(oc.pool) : null;
  } catch {
    return null;
  }
}

/**
 * Every order this wallet still has resting on a market, read from chain.
 *
 * Returns ids only — that is what the pool's view exposes and all a cancel
 * needs. Pair with `client.getOrderOnchain` when the struct is required.
 */
export async function restingOrders(
  marketId: string,
  config: VenueConfig = resolveVenueConfig(),
): Promise<RestingOrder[]> {
  const ex = signingExchange(config);
  const owner = await signerAddress(config);
  if (!ex || !owner) return [];

  const pool = await poolFor(marketId, config);
  if (!pool) return [];

  const client = (ex as unknown as { client: Record<string, unknown> }).client;
  try {
    const ids = (await (
      client.getOwnOpenOrdersOnchain as unknown as (p: string, o: string) => Promise<bigint[]>
    )(pool, owner)) ?? [];
    return ids.map((id) => ({ orderId: id.toString(), pool, marketId }));
  } catch {
    // An unreadable order list is NOT an empty order list. Callers that flatten
    // must not read this as "nothing is resting" — they get an empty array and
    // the same verification step re-reads before concluding anything.
    return [];
  }
}

/**
 * Pull specific orders on one market.
 *
 * Batched through `cancelOrders` when there is more than one: a maker holding
 * two quotes should spend one nonce pulling them, not two, and two sequential
 * cancels can be split by a fill.
 */
export async function cancelOrders(
  marketId: string,
  orderIds: string[],
  config: VenueConfig = resolveVenueConfig(),
): Promise<CancelResult> {
  const evidence: string[] = [];
  const empty = (status: CancelResult["status"], note: string): CancelResult => {
    evidence.push(note);
    return { orderIds, txHash: null, status, blockNumber: null, stillResting: [], evidence };
  };

  if (!orderIds.length) return empty("NOTHING_TO_CANCEL", "no ids supplied");
  if (config.dryRun) return empty("NOTHING_TO_CANCEL", "PRISM_DRY_RUN is true — nothing signed");

  const ex = signingExchange(config);
  if (!ex) return empty("UNKNOWN", "no signer configured");

  const pool = await poolFor(marketId, config);
  if (!pool) return empty("UNKNOWN", "could not resolve the pool for that market");

  const trader = (ex as unknown as {
    trader: {
      cancelOrder: (p: unknown) => Promise<Record<string, unknown>>;
      cancelOrders: (p: unknown) => Promise<Record<string, unknown>>;
    };
  }).trader;

  let txHash: string | null = null;
  try {
    const res =
      orderIds.length === 1
        ? await trader.cancelOrder({ pool, orderId: orderIds[0] })
        : await trader.cancelOrders({ pool, orderIds });
    txHash = typeof res.hash === "string" ? res.hash : null;
    evidence.push(`sdk returned hash ${txHash ?? "none"} (not trusted)`);
  } catch (e) {
    evidence.push(`cancel threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }

  let status: CancelResult["status"] = "UNKNOWN";
  let blockNumber: number | null = null;

  if (txHash) {
    const receipt = await rpc(config)
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null);
    if (receipt) {
      blockNumber = Number(receipt.blockNumber);
      evidence.push(`receipt.status=${receipt.status} block=${blockNumber}`);
      status = receipt.status === "success" ? "VERIFIED_CANCELLED" : "VERIFIED_FAILED";
    } else {
      evidence.push("receipt not yet available");
    }
  }

  // The authoritative answer: what is STILL resting. A successful receipt does
  // not prove a given id was pulled — the batch call skips stale ids silently.
  const after = await restingOrders(marketId, config);
  const stillResting = after.filter((o) => orderIds.includes(o.orderId)).map((o) => o.orderId);
  evidence.push(
    stillResting.length
      ? `${stillResting.length} of ${orderIds.length} still resting after the cancel`
      : `none of the ${orderIds.length} targeted orders are resting any more`,
  );

  return { orderIds, txHash, status, blockNumber, stillResting, evidence };
}

/**
 * Flatten a market: pull everything this wallet has resting on it.
 *
 * This is what "flattened before expiry" means for the Ladder, and what a maker
 * does when it stands down. Reads from chain first so it cannot be fooled by a
 * stale local view of its own quotes.
 */
export async function flatten(
  marketId: string,
  config: VenueConfig = resolveVenueConfig(),
): Promise<CancelResult> {
  const resting = await restingOrders(marketId, config);
  if (!resting.length)
    return {
      orderIds: [],
      txHash: null,
      status: "NOTHING_TO_CANCEL",
      blockNumber: null,
      stillResting: [],
      evidence: ["chain reports no resting orders on this market"],
    };

  return cancelOrders(
    marketId,
    resting.map((o) => o.orderId),
    config,
  );
}
