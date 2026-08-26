# Architecture

PRISM is a **client** of DreamDEX, not a venue. There are no PRISM contracts:
the binary markets, pools and tUSDC are deployed by DreamDEX, and PRISM reads,
trades and settles against them.

```
                          User
                            |
                            v
                   +----------------+
                   |   PRISM UI     |  Next.js App Router
                   |   (Vercel)     |  every venue page is force-dynamic
                   +-------+--------+
                           |  server actions only - the SDK never
                           |  reaches a browser bundle
        +------------------+------------------+
        v                                     v
+---------------+                    +-----------------+
| sdk/venue     |                    | sdk/dreamdex    |
|  markets      | discovery          |  execution      | validate/submit/verify
|  prices       | EMA oracle         |  place-limit    | integer tick grid
|  config       | verified consts    |  settlement     | finalized sweep
|  types        | EventMarket        |  roll           | succession
+-------+-------+                    |  proof          | re-verify per request
        |                            |  history        | explorer account API
        |                            +--------+--------+
        +--------------+----------------------+
                       v
          @somnia-chain/markets-sdk 0.28.1
                       |
        +--------------+--------------+
        v              v              v
  indexer         raw trader      EMA oracle
  (GraphQL)       (bigint)        (price feed)
                       |
                       v
                Somnia Shannon
                       |
                       v
        +------------------------------+
        |  VERIFICATION LAYER          |
        |  raw RPC, independent of SDK |
        |  receipt / nonce / balance   |
        +--------------+---------------+
                       v
               Shannon explorer

  +---------------------------------------------+
  |  services/roll  - the daemon Vercel cannot   |
  |  host. One sequential loop: roll, then claim |
  |  same key, so never two senders              |
  +---------------------------------------------+
```

## Why the split

**`sdk/venue` is read-only.** Discovery, prices, normalization. Safe anywhere on
the server; needs no key.

**`sdk/dreamdex` can move funds.** Everything that signs lives here, behind
`server-only`. React orchestrates state; it never calls the SDK.

**`services/roll` is separate because Vercel cannot host it.** Carrying a
position across windows needs a process that stays awake. A serverless function
cannot, and neither can a browser tab.

**`services/executor` is single-writer by construction.** Nonces are sequential,
so two senders on one key race and the loser dies with `nonce too low`. The web
tier is serverless — many instances, no shared memory, no coordination — so
in-process signing is correct at ONE instance and silently broken at two. One
executor, one queue, `replicas: 1`. Scaling it reintroduces the bug it exists to
prevent.

**`services/market-data` is the mirror image.** It holds no key, so it scales
horizontally without limit. That asymmetry — one service that must NOT scale,
one that can — is the only honest reason these are two services.

**When a wallet is connected, none of this is on the critical path.** The user
signs from their own address, so there is no shared nonce at all. The executor
exists for the demo burner and for the daemon, which have no user to sign for
them.

## The verification rule

The SDK response is **evidence, not truth**. A DreamDEX write can resolve
without throwing even when the transaction reverted. So every write is
re-derived from chain - receipt status, nonce movement, collateral delta - and
the verifier is allowed to answer `UNKNOWN`. `UNKNOWN` is never rendered as
success.

## Data flow, one request

```
/trade
  page.tsx (server)
    getMarketSnapshot()      548 rows -> typed EventMarket
    successionChain()        the windows this view rolls through
    fetchOrderBook()         real resting depth, per outcome
    getPriceSnapshot()       oracle candles
  -> terminal.tsx (client)
       one market object; every panel derives from it
  -> ExecutePanel
       server action: validate -> preflight -> submit -> verify
```

No component holds a second copy of market state. Asset and window are
navigation - picking one binds a different real market by id.
