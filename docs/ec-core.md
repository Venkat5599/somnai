# On `@dreamdex-bot-kit/ec-core`

PRISM does not depend on it. That is a constraint, not an oversight.

## It cannot be installed

```
registry.npmjs.org/@dreamdex-bot-kit/ec-core   ->  {"error":"Not found"}
packages/ec-core/package.json                  ->  "private": true
```

`ec-core` is a private workspace package inside the bot-kit monorepo. It is not
published, so it cannot be added as a dependency. The only ways to "use" it are
to vendor its source — a fork, which then drifts — or to implement the same
behaviours against the same SDK.

PRISM does the latter, and the parts that matter are ported deliberately rather
than reinvented.

## What was ported, and where it lives

| ec-core behaviour | PRISM |
|---|---|
| Integer tick/lot conversion, never a float | `sdk/dreamdex/grid.ts` — `toSteps()` |
| Raw-tier placement with explicit order type | `sdk/dreamdex/place-limit.ts` |
| `assertTxOk` — a reverted write does not throw | `place-limit.ts` |
| Expiry capped at the market's own | `place-limit.ts`, `backend/roll` |
| NO price as the integer complement in YES terms | `place-limit.ts`, `prepare.ts` |
| Settled sweep via `listBinaryMarkets({Finalized})` | `sdk/dreamdex/settlement.ts` |
| Redeem with an **explicit** `outcomeIdx` | `settlement.ts` |
| Claim in the trading loop, never a timer | `backend/roll` — one sequential loop |
| Expiry headroom scaled to the interval | `sdk/venue/types.ts` — `headroomSec()` |

## Where PRISM went further

**The grid is read from the venue, not branched on network.** `ec-core` carries
per-network `MM_TICK` / `MM_LOT` defaults. PRISM calls
`getBinaryBookParams(pool)` and uses `tickSize`/`lotSize` from the venue itself,
falling back to the constants only when the chain read fails. That follows
Somnia's own "first order" recipe: ask the venue for its rules and one code path
works on either chain.

**Order types come from the SDK enum.** Hand-typing them was wrong here —
`POST_ONLY` had been set to `1`, which is `FILL_OR_KILL`. A post-only order,
whose entire purpose is to rest and never take, would have been sent as
all-or-nothing-immediately. Now imported: `{ LIMIT: 0, FILL_OR_KILL: 1,
MARKET: 2, POST_ONLY: 3 }`.

**Verification does not trust the SDK at all.** `ec-core`'s `assertTxOk` checks
the receipt on the returned object. PRISM re-reads the receipt over raw RPC,
plus nonce movement and the collateral delta, and is allowed to answer
`UNKNOWN`. The SDK response is evidence; the chain is the verdict.

## What was not ported

`ec-core`'s market-making strategies (`ec-maker`, `ec-passive`,
`ec-laddering-bot`) are quoting loops. PRISM is not a market maker — it composes
positions across succession — so they have no place here.
