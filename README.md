# PRISM

[![CI](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml/badge.svg)](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml)

**A structured strategy layer built on DreamDEX Event Contracts.**

DreamDEX lists binary Up/Down markets on BTC and ETH that expire every few
minutes. PRISM reads those markets live from Somnia, prices structures against
them, and executes real orders on-chain — with every claim in the interface
backed by verifiable chain state.

- **Live demo** — [prism-dex.vercel.app](https://prism-dex.vercel.app)
- **Network** — Somnia Shannon testnet (chain `50312`)
- **Verified trade** — [`0xd6f0a3e2…fef65e`](https://shannon-explorer.somnia.network/tx/0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e)

---

## The problem

An Event Contract is a cash-or-nothing digital: it pays 1 tUSDC if the
underlying finishes above a strike at the close of a fixed window, and 0
otherwise. That makes it a genuine derivatives primitive.

It is also **extremely short-lived**. The venue's routable windows are five
minutes long. A trader who wants exposure lasting longer than one window has to
rediscover markets, re-strike, and re-enter continuously — by hand, every five
minutes, forever.

PRISM exists to abstract that away: state a view once, and carry it across
successive contract windows.

---

## What works today

Everything in this section is live and independently verifiable. Nothing is
simulated.

### Live now

| Capability | Evidence |
|---|---|
| Market discovery | 548 binary markets read from the Somnia indexer |
| Market normalization | `UnifiedMarket` → typed `EventMarket` at one boundary |
| Routability detection | struck / unstruck / expired / inside-headroom, from chain fields |
| Oracle prices | live BTC & ETH from Somnia's on-chain EMA oracle |
| OHLC candles | real 1m/1h/1d candles, charted with TradingView's `lightweight-charts` |
| **Real execution** | order signed, submitted, mined — [tx on explorer](https://shannon-explorer.somnia.network/tx/0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e) |
| **Independent verification** | outcome re-derived from receipt, nonce and balance delta |

### Not implemented

Stated plainly, because the interface used to imply otherwise:

- Automated roll execution across window succession
- Atomic multi-leg batching (EIP-7702)
- Settlement and claim automation
- Persistent portfolio state
- Range / Spread / Ladder structures — see *Known limitations*

Screens still backed by fixtures (`/positions`, `/settlement`, `/roll`,
`/activity`, `/agents`, `/analytics`, `/structures`) carry a **Sample data**
banner in the UI.

---

## Architecture

```
                         User
                          │
                          ▼
                     PRISM UI  (Next.js App Router)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
      Payoff engine            Execution adapter
      src/lib/quant.ts       src/lib/dreamdex/
      pure, React-free         execution.ts
              │                       │
              └───────────┬───────────┘
                          ▼
                    Venue adapter
                   src/lib/venue/
              markets · prices · config
                          │
                          ▼
              @somnia-chain/markets-sdk
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
      DreamDEX Event          Somnia EMA oracle
        Contracts                (price feed)
              │
              ▼
        Somnia Shannon
              │
              ▼
      Verification layer  ← raw RPC, independent of the SDK
              │
              ▼
      Shannon explorer
```

React components never call the SDK. All protocol interaction lives behind the
adapters.

---

## Live market flow

```
loadMarkets(true)          548 binary rows from the indexer
        ↓
normalizeMarket()          stringified fields → typed numbers, once
        ↓
strike === 0 → null        "not struck yet" is a real state, not a price
        ↓
isRoutable()               active · Trading · struck · outside headroom
        ↓
/markets → /trade          the real marketId is handed over, never a fixture
```

**Venue scoping is deliberately unfiltered.** Active markets span *two* venue
ids on testnet; pinning the single id published in the bot-kit README hides half
the live book.

---

## Execution flow

```
validateOrder()   →  reject before a signature exists
        ↓
preflightSnapshot()  →  nonce + collateral balance, for attribution
        ↓
submitOrder()     →  createOrder(ref, "limit", side, amount, price, {IOC})
        ↓
verifyExecution() →  re-derive the outcome from chain state
        ↓
VERIFIED_EXECUTED | VERIFIED_FAILED | PENDING | UNKNOWN
```

Orders are **IOC** so no resting remainder is left with escrow locked.

Validation rejects — before signing, costing no gas — on: dry-run enabled, no
signer, market not found, not active, not Trading, unstruck, expired, inside
expiry headroom, non-positive size, below venue minimum, price outside `(0,1)`,
no book liquidity, insufficient collateral, insufficient gas.

---

## Verification — why the SDK response is not the truth

The DreamDEX bot kit documents that a write **can resolve without throwing even
when the underlying transaction reverted**, and that the receipt rides on `info`
rather than the returned order. A `success` flag is therefore *evidence*, not a
verdict.

`verifyExecution()` never reads the SDK's status. It re-derives the outcome from
chain state via raw RPC:

1. `eth_getTransactionReceipt` — `status` is authoritative when a hash exists
2. `eth_getTransactionCount` — nonce movement proves something was broadcast
3. `balanceOf(tUSDC)` — a real delta proves collateral actually moved

It is allowed to answer **`UNKNOWN`**, and the UI renders `UNKNOWN` as
`UNKNOWN`. An explorer link is constructed **only** from a hash that survived
verification.

### The verified trade

```
market   ETH-246144-26AUG26-0340/tUSDC   (5m window)
action   BUY 1 YES, crossing the resting ask at 0.953
tx       0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e
block    471,425,180

receipt.status              0x1 (success)
nonce                       0 → 0x2
tUSDC balanceOf             500.000000 → 499.114000
```

The **−0.886 against an offered 0.953** is not a discrepancy: the bot kit
documents that a taker is charged the *fill* price, not the price it offered.
Observing exactly that is itself corroboration the fill was real.

---

## Known limitations

**The venue lists one strike per window.** Verified across every live market:

```
BTC/5m 1   BTC/15m 1   BTC/1h 1   BTC/4h 1   BTC/24h 1
ETH/5m 1   ETH/15m 1   ETH/1h 1   ETH/4h 1   ETH/24h 1
```

A strike *ladder* is therefore not available, which means:

- **Range, Spread and Ladder cannot be routed** — each needs two or more strikes
  on one expiry. The UI flags them rather than fabricating legs.
- **Risk-neutral density and a strike-axis vol surface are not derivable** — both
  require differentiating across strikes.
- **Directional and Calendar are the constructible pair.**

This is why PRISM composes along **time** rather than along strike. Five real
cadences exist per asset, and `successionChain()` already returns them.

Other limits: most longer windows carry `strike: 0` (listed, not yet struck);
only 5m windows were routable during development, so a live demo must execute
inside a ~5 minute window.

---

## Local development

```bash
bun install
cp .env.example .env.local     # then fill in the values below
bun run dev                    # http://localhost:3177
```

```bash
bun run typecheck              # tsc --noEmit
bun run test                   # vitest — 25 tests
bun run build                  # production build
```

Diagnostics that hit the live venue:

```bash
bun scripts/probe-venue.mjs        # market discovery + venue scoping
bun scripts/probe-pricefeed.mjs    # oracle prices + candles
bun --conditions react-server scripts/verify-markets.ts
bun scripts/probe-exec.ts          # balances, order book (places NO order)
```

---

## Environment variables

Names only. Never commit values; `.env*` is gitignored.

| Variable | Purpose |
|---|---|
| `PRISM_NETWORK` | `testnet` or `mainnet` |
| `PRISM_RPC_URL` | Somnia JSON-RPC |
| `PRISM_INDEXER_URL` | GraphQL indexer — **not** the RPC url |
| `PRISM_WS_RPC_URL` | chain websocket |
| `PRISM_VENUE_ID` | optional venue pin; unset accepts all venues |
| `PRISM_DRY_RUN` | `true` blocks all signing. Only `false` enables execution |
| `PRIVATE_KEY` | signer. Use a burner holding testnet value only |

> The indexer URL is a different host from the RPC. Passing the RPC where the
> indexer belongs fails with `RegistryMarkets failed: empty response`, which
> reads like an outage rather than a config mistake.

---

## Testing

```
tests/quant.test.ts        payoff maths, quantisation, PAVA repair, depth limits
tests/routability.test.ts  expiry headroom, struck/unstruck, status gating
```

25 tests, all pure — no mocked blockchain. Live-network behaviour is verified
manually against Shannon and recorded above; that is stated separately rather
than dressed up as integration coverage.

---

## Stack

Next.js 15 · React 19 · TypeScript (strict) · Tailwind v4 ·
`@somnia-chain/markets-sdk` · viem · lightweight-charts · Geist Mono ·
Vitest · Bun

---

*Testnet build. Educational reference, not financial advice.*
