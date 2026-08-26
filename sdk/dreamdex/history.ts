import "server-only";

/**
 * Real transaction history for the signer.
 *
 * Read from the Shannon explorer's account API, not from an in-app log. The
 * previous /activity page was a static array of invented rows with hashes that
 * 404'd on the explorer; this is the wallet's actual on-chain record, and every
 * hash resolves because the explorer is where it came from.
 *
 * The indexer's Portfolio query is the richer source (it carries fills and
 * order ids) but it times out regularly on this testnet. The explorer account
 * API is the one that answers reliably, so it is the primary here.
 */

import { COLLATERAL, resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";

export interface HistoryRow {
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string | null;
  /** Chain verdict. A reverted transaction still appears — it happened. */
  success: boolean;
  gasUsed: number;
  /** Native STT moved. Usually 0: these are contract calls, not transfers. */
  value: number;
  /** Best-effort label from the call target and method selector. */
  kind: string;
  methodId: string | null;
}

/** Contract targets we can name, learned from PRISM's own verified writes. */
const KNOWN: Record<string, string> = {
  "0x645b9b09b085326afa00efd9daf5c61f8401a694": "Order placement",
  "0x3ecc694cef705358864a646142ac17a90e29e388": "Settlement / redeem",
  [COLLATERAL.address.toLowerCase()]: `${COLLATERAL.symbol} token`,
};

function label(to: string | null, input: string): string {
  if (!to) return "Contract deploy";
  const known = KNOWN[to.toLowerCase()];
  if (known) return known;
  // 0xa9059cbb = transfer, 0x095ea7b3 = approve
  const sel = input.slice(0, 10).toLowerCase();
  if (sel === "0xa9059cbb") return "Token transfer";
  if (sel === "0x095ea7b3") return "Token approval";
  return "Contract call";
}

/**
 * Fetch the signer's transactions, newest first.
 *
 * Returns an empty list rather than throwing: an unreachable explorer should
 * render "no history available", never fabricate rows or crash the page.
 */
export async function getHistory(
  address: string,
  limit = 25,
  config: VenueConfig = resolveVenueConfig(),
): Promise<{ rows: HistoryRow[]; error: string | null }> {
  const url =
    `${config.explorer}/api?module=account&action=txlist` +
    `&address=${address}&page=1&offset=${limit}&sort=desc`;

  try {
    const res = await fetch(url, {
      // Live wallet state; a cached audit log would be worse than none.
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { rows: [], error: `explorer returned HTTP ${res.status}` };

    const body = (await res.json()) as { result?: unknown };
    const raw = Array.isArray(body.result) ? body.result : [];

    const rows: HistoryRow[] = raw.map((r) => {
      const t = r as Record<string, string>;
      const input = t.input ?? "";
      return {
        hash: t.hash,
        blockNumber: Number(t.blockNumber ?? 0),
        timestamp: Number(t.timeStamp ?? 0),
        from: t.from,
        to: t.to || null,
        // Blockscout reports isError "0" for success.
        success: t.isError !== "1" && t.txreceipt_status !== "0",
        gasUsed: Number(t.gasUsed ?? 0),
        value: Number(t.value ?? 0) / 1e18,
        kind: label(t.to || null, input),
        methodId: input.length >= 10 ? input.slice(0, 10) : null,
      };
    });

    return { rows, error: null };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message.slice(0, 140) : String(e),
    };
  }
}
