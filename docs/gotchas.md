# Venue behaviour PRISM designs around

Every item here was reproduced live on Shannon, not read from a doc.

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

## 8. Smaller edges

- `strike: 0` means *not struck yet*, not a price.
- Active markets span **two venue ids**; pinning the documented one hides half
  the book.
- Pools are recycled across windows - key state by `marketId`, never by pool
  address.
- Expiry headroom must scale to the interval. A flat 300s rule rejects every
  market on a venue running 5-minute windows.
- `getMarketOnchain` resolves through the binary module, so the address book
  must be supplied or every settlement read throws `NotConfiguredError`.
- The testnet Portfolio query times out often. The explorer account API is the
  reliable source for wallet history.
