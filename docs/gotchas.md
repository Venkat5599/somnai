# Venue behaviour PRISM designs around

Every item in the numbered sections was reproduced live on Shannon, not read
from a doc. The table at the end reconciles them with the twelve the bot kit
publishes, so the two lists can be compared rather than assumed to agree.

## 1. One strike per window

Verified across all live markets:

```
BTC/1m 1  BTC/5m 1  BTC/15m 1  BTC/1h 1  BTC/4h 1  BTC/24h 1
ETH/1m 1  ETH/5m 1  ETH/15m 1  ETH/1h 1  ETH/4h 1  ETH/24h 1
```

There is **no strike ladder**. Range, Spread and Ladder need two or more strikes
on one expiry, so they are not constructible. Neither is a risk-neutral density
nor a strike-axis vol surface - both require differentiating across strikes.

PRISM therefore composes along **time**, not strike. That is the product.

## 2. The indexer is not the RPC

```
indexer  https://dev.smk.somnia.host/v1/graphql
rpc      https://api.infra.testnet.somnia.network
oracle   https://price-feed.dev.oracle.somnia.host/v1/graphql
```

Passing the RPC where the indexer belongs fails with
`RegistryMarkets failed: empty response`, which reads like an outage rather than
a config mistake.

## 3. loadMarkets cannot find your winnings

The registry **excludes finalized markets**, so a redeem-by-scan built on it
finds nothing - on exactly the markets you need to claim from. Worse, the
unified `exchange.redeem()` resolves its ref through the same registry and
throws `unknown market ref` on every finalized market. Both reproduced here.

The path that works:

```
listBinaryMarkets({ status: "Finalized" })
getMarketOnchain(marketId)          -> isResolved / isVoided
getOutcomeBalance(token, acct, id)  -> real ERC-6909 holdings
trader.redeem({ ..., outcomeIdx })  -> RAW tier, EXPLICIT outcome
```

The outcome index must be explicit: a **voided market pays both sides 0.5** and
has no winning outcome to infer.

## 4. Float prices break an 18-decimal venue

`createOrder` converts with `parseUnits(price.toFixed(decimals))`.
`(0.05).toFixed(18)` is `"0.050000000000000003"` - three wei off the tick grid,
rejected as `InvalidPrice`. Only `0.25`, `0.5` and `0.75` survive: the values
binary floating point represents exactly.

**A 6-decimal venue never shows this.** Shannon is 6dp, so the bug is invisible
in development and fatal on mainnet. PRISM converts in tick and lot integer
units. `tests/grid.test.ts` reproduces the failure before proving the fix.

## 5. A reverted write does not throw

The receipt rides on `info`. Every write is asserted explicitly.

## 6. Successors are not pre-struck

Polled all twelve chains for seventeen minutes: every one reported *no successor
listed*. The venue strikes the next window only as the current one nears close.

This is why the roll daemon exists - nobody can sit watching for a window that
opens unpredictably and closes in minutes.

## 7. A taker pays the fill price

Offered 0.953, paid 0.886. Seeing that delta is corroboration a fill was real.

## 9. A resting order aimed into a close reverts as ALREADY EXPIRED

The taker path never sees this, because an IOC order either crosses now or is
gone. A POST-ONLY order is meant to sit, so the venue judges whether it has time
to sit at all — and refuses when it does not.

Reproduced on Shannon. First attempt, on a routable window with little life
left:

```
ExecutionRevertedError: execution reverted
data: 0x3154078e   ->   OrderAlreadyExpired()
```

`0x3154078e` decodes against the SDK's own error ABIs (412 of them) to
`OrderAlreadyExpired()`. The name misleads: the ORDER's `expireTimestampNs` was
correct — now + 300s, verified by decoding the calldata. The verdict is about
the MARKET. The venue will not accept a resting order into a window that is
about to close, because it would be cancelled on arrival.

Same order, same price and size, on a window with 228s left:

```
place   0x2bc57a675bdea676be1f57d889e3e3b11d708e424de04ecc136c02879292df8b
        orderId 73786976294838713577, filled 0, rested true
        chain reports 1 resting order
cancel  0x945a0901c420b8171668040435d2ba249656fffb8c4515d669881303814a69ba
        block 478935387, VERIFIED_CANCELLED, stillResting []
```

So PRISM refuses a rest below `max(headroom, 60s)` before signing, in
`restBid`. Refusing costs nothing; the revert cost gas. This is the taker-side
headroom rule of edge 8 again, at a threshold the making path needs and the
taking path does not.

## 8. Smaller edges

- `strike: 0` means *not struck yet*, not a price.
- Active markets span **more than one venue id**, and the count moves - two when
  this was written, four when last read. Pinning the documented one hides most of
  the book. No number is asserted here on purpose; `MarketSnapshot.venues` counts
  it live.
- Pools are recycled across windows - key state by `marketId`, never by pool
  address.
- Expiry headroom must scale to the interval. A flat 300s rule rejects every
  market on a venue running 5-minute windows.
- `getMarketOnchain` resolves through the binary module, so the address book
  must be supplied or every settlement read throws. **This was written down here
  and then not applied**: `signingExchange` passed the book, the read-only
  `exchange()` in `sdk/venue/markets.ts` did not, and the wallet-connected path -
  which builds its unsigned order through that exchange - failed in production
  with `VENUE_UNREADABLE: Nothing was built to sign`. A gotcha in a document is
  not a gotcha in the code. `scripts/probe-prepare.ts` now checks it.
- The testnet Portfolio query times out often. The explorer account API is the
  reliable source for wallet history.

---

## Reconciliation with the bot kit's own list

The kit publishes twelve sharp edges in
[`docs/event-contracts.md`](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/event-contracts.md).
This file had eight, arrived at independently by reproducing them live. Mapping
the two lists is how you find the ones nobody hit yet.

| # | Kit's sharp edge | Where PRISM handles it |
|---|---|---|
| 1 | Only status 1 (Trading) accepts orders; don't trust the indexer | `isRoutable`, and `validateOrder` rejects `MARKET_NOT_TRADING` |
| 2 | SDK writes skip simulation — check the receipt with `assertTxOk` | `assertTxOk` in `place-limit.ts`; `verifyExecution` re-derives from chain (gotcha 5) |
| 3 | Float prices misalign the tick grid on 18-decimal venues; use `placeLimit` | `sdk/dreamdex/grid.ts` + `place-limit.ts` (gotcha 4) |
| 4 | Unfilled limits rest with escrow locked — be explicit about IOC vs resting | IOC by default; `cancel.ts` pulls resting quotes; quote loop flattens on exit |
| 5 | Every order needs `expireTimestampNs`, capped at market expiry | `place-limit.ts` — mandatory, `Math.min(wanted, onchain.expiry)` |
| 6 | Use `quantize`; the SDK's `amountToPrecision` floors small sizes to zero | `toSteps(..., "floor")` in `grid.ts`, in lot units |
| 7 | Escrow leaves and returns to the wallet — verify funding before signing | `readBalances` + `checkSpend`; `INSUFFICIENT_COLLATERAL` gated pre-signature |
| 8 | Expiry headroom scales to the interval, not a fixed threshold | `headroomSec()` — 8% of interval, floored at 5s (gotcha 8) |
| 9 | Indexer lags; treat on-chain state as authoritative | `verifyExecution` and `cancel.ts` read chain, never the indexer's view |
| 10 | Markets recycle — key state by `marketId`, never pool address | `EventMarket.marketId` is the stable key (gotcha 8) |
| 11 | `loadMarkets()` cannot find finalized binaries; use `listBinaryMarkets` | `findClaimable` in `settlement.ts` (gotcha 3) |
| 12 | Don't parse the question text; read `strike` and `intervalSec` | `normalize.ts` reads the fields; `question` is carried but never parsed |

**All twelve are covered.** Four of PRISM's eight are not on the kit's list at
all — one strike per window, the indexer/RPC host confusion, successors not being
pre-struck, and a taker paying the fill price rather than the offer. Those came
from running against the venue rather than reading about it, which is the point
of this file.

**One was covered on paper and not in code.** The kit's edge 2 and this file's
address-book note were both written down while `sdk/venue/markets.ts` still
constructed its client without an address book — see the note under *Smaller
edges*. Documentation is not a control.

### The funding model

The kit flags that `placeOrder` became `payable` with **auto-pull**: it draws
collateral from the wallet directly, with no separate deposit step, and
`placeTakerOrderWithoutVault` is removed. PRISM is on the correct side of this by
construction — it routes through `trader.placeOrder` on SDK 0.28.1 and has no
vault, deposit or withdraw code anywhere in the tree. Verified by grep, not by
assumption; there is nothing to migrate.
