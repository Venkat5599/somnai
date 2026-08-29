import "server-only";

/**
 * An exchange that can BUILD a transaction without being able to send one.
 *
 * THE BUG THIS EXISTS FOR:
 *
 *   VENUE_UNREADABLE: Nothing was built to sign: createTrader is authenticated
 *   — construct SomniaMarkets with a privateKey / account / walletClient
 *
 * `prepare.ts` produces UNSIGNED calldata for a user's own wallet, so by
 * definition it holds no key. But the SDK gates the entire `trader` getter
 * behind authentication, and `buildPlaceOrder` — which only encodes a call and
 * signs nothing — lives on that getter. So the read-only client could never
 * reach the one function whose whole purpose is to avoid signing.
 *
 * The SDK's own error names the way out: it accepts an `account` as well as a
 * `privateKey`. An account is an ADDRESS, not a secret. Constructing with the
 * connected user's address satisfies `createTrader`, lets `buildPlaceOrder`
 * encode against the right owner, and still cannot sign anything — there is no
 * private material anywhere in this path.
 *
 * That property is the point, so it is worth stating plainly: this module can
 * produce a transaction and is structurally incapable of broadcasting one.
 */

import {
  SomniaMarkets,
  SOMNIA_TESTNET_PRICE_FEED,
  SOMNIA_TESTNET_ADDRESSES,
  SOMNIA_MAINNET_ADDRESSES,
} from "@somnia-chain/markets-sdk";
import { somniaShannon, somniaMainnet } from "@somnia-chain/markets-sdk/chains";
import { createWalletClient, http } from "viem";
import { resolveVenueConfig, type VenueConfig } from "@sdk/venue/config";

/** Cached per (network, owner): the SDK opens a socket and holds a store. */
let cached: { key: string; ex: SomniaMarkets } | null = null;

/**
 * Build-only exchange bound to `owner`.
 *
 * `owner` must be a real address — the transaction is encoded for it, and the
 * approval in particular is owner-specific, so a placeholder would produce
 * calldata the user's wallet would sign against the wrong account.
 */
export function builderExchange(
  owner: string,
  config: VenueConfig = resolveVenueConfig(),
): SomniaMarkets {
  const key = `${config.network}|${owner.toLowerCase()}`;
  if (cached?.key === key) return cached.ex;

  const chain = config.network === "mainnet" ? somniaMainnet : somniaShannon;
  const ex = new SomniaMarkets({
    chain,
    indexerUrl: config.indexer,
    wsRpcUrl: config.wsRpc,
    priceFeed: SOMNIA_TESTNET_PRICE_FEED,
    addresses:
      config.network === "mainnet" ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES,
    // A WALLET CLIENT, not an address.
    //
    // The SDK's error names "privateKey / account / walletClient", but
    // `resolveSigner` actually checks for a viem Account OBJECT or a wallet
    // client — an address string satisfies neither, so passing `account: owner`
    // still threw. A probe caught that; the error text was misleading and the
    // code is the authority.
    //
    // This client is bound to the user's address over plain HTTP and holds NO
    // key, so it can encode a transaction for that owner and is structurally
    // unable to sign one. Any attempt to send through it fails at viem, which
    // is the property we want: build yes, sign never.
    walletClient: createWalletClient({
      account: owner as `0x${string}`,
      chain,
      transport: http(config.rpc),
    }),
  } as never);

  cached = { key, ex };
  return ex;
}
