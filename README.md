# PRISM

[![CI](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml/badge.svg)](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml)

**Strategy infrastructure for DreamDEX Event Contracts.**

DreamDEX Event Contracts expire every few minutes. PRISM turns those ephemeral
contracts into positions with a real tenor — reading live markets from Somnia,
executing against them, verifying the result independently of the SDK, settling
them, and carrying a view into the successor window.

```
EVENT CONTRACT → STRATEGY → RISK → EXECUTION → VERIFICATION → SETTLEMENT → CONTINUITY
```

- **Live demo** — [prism-terminal-cyan.vercel.app](https://prism-terminal-cyan.vercel.app)
- **On-chain proof** — [/proof](https://prism-terminal-cyan.vercel.app/proof), re-read from chain on every request
- **Network** — Somnia Shannon testnet (chain `50312`)

---

## The problem

An Event Contract is a cash-or-nothing digital: it pays 1 tUSDC if the
underlying finishes above a strike at window close, 0 otherwise. A real
derivatives primitive.

It is also **extremely short-lived**. Routable windows are minutes long, and the
venue does not pre-strike successors — measured across all twelve live chains,
every one reported *no successor listed* for seventeen minutes straight. A
trader wanting exposure beyond one window must rediscover, re-strike and
re-enter continuously, by hand, forever.

PRISM exists to remove that.

## Why DreamDEX specifically

The venue lists **one strike per window** and five cadences per asset. That kills
composition across strike — no ladder, no Range, no Spread, no risk-neutral
density — and makes composition across **time** the only real axis. PRISM is
built on the axis the venue actually has, not the one a generic options UI
assumes.

---

## What is real

Everything below executes against Somnia and is independently verifiable.
**There is no simulated data anywhere in this repository.**

| Capability | Evidence |
|---|---|
| Market discovery | 548 binary markets from the Somnia indexer |
| Normalization | `UnifiedMarket` → typed `EventMarket` at one boundary |
| Routability | struck / unstruck / expired / inside-headroom, from chain fields |
| Oracle prices | live BTC & ETH from Somnia's on-chain EMA feed |
| OHLC candles | real 1m/1h/1d, charted with TradingView's `lightweight-charts` |
| **Execution** | signed, mined, verified — [tx](https://shannon-explorer.somnia.network/tx/0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e) |
| **Settlement** | finalized sweep, fee-aware payout, real redeem |
| **Verification** | outcome re-derived from receipt, nonce and balance delta |
| **Non-custodial signing** | RainbowKit — users sign with their own key |
| Roll planner + daemon | real succession chains, typed blockers |
| Wallet history | read from the Shannon explorer account API |

### Not implemented, and why

Each of these was "planned" until it was actually checked. Two turned out to be
unreachable rather than unbuilt, and both are now **probed at runtime** instead
of asserted, so the UI stops claiming them the moment the chain changes.

**Atomic multi-leg batching (EIP-7702) — unavailable on this chain.**
EIP-7702 ships in Prague. Shannon carries none of Prague's system contracts
(`0x…2935`, `0x…7002`), nor Cancun's beacon-roots contract, and its block
headers have no `withdrawalsRoot`, `excessBlobGas` or `requestsHash`. Probing
by transaction envelope is useless here — the node answers a malformed type-`0x2`,
a type-`0x4` and a nonexistent type-`0x7f` with the identical
`invalid transaction / 0x08`, verified against a negative control — so
[`sdk/venue/capabilities.ts`](sdk/venue/capabilities.ts) detects the fork by
system-contract presence instead.

In its place, [`sdk/dreamdex/batch.ts`](sdk/dreamdex/batch.ts) delivers the
guarantee 7702 was wanted for, as far as this chain allows:

| | |
|---|---|
| `PREFLIGHT_ALL_OR_NOTHING` | every leg gated before a signature exists — nothing is sent |
| `SEQUENTIAL_VERIFIED` | every leg filled, each verdict read from its own receipt |
| `PARTIAL_UNWOUND` | a leg failed; the filled legs were sold back and the sale verified |
| `PARTIAL_EXPOSED` | a leg failed **and** an unwind failed — read this one |

Legs go out `FILL_OR_KILL`, so a leg either exists whole or not at all and an
unwind never faces a partial. **This is not atomic**: between the first fill and
the unwind there is a real window in which the position is one-sided.

It is driven from **Basket** on [`/structures`](https://prism-terminal-cyan.vercel.app/structures)
— pick two to four routable legs, price them, open them — and the panel renders
the raw `atomicity` field, never a boolean and never a green tick. `PARTIAL_EXPOSED`
is styled to be impossible to skim past, because it means size is still on and
the reader has to act.

> This claim used to be false. `batch.ts` shipped with **no importer at all**
> while this file said "the UI prints it" — a library nobody called, which
> typecheck, tests and the build all pass happily. `tests/deploy-config.test.ts`
> now walks the tree for real `from "…"` clauses and fails any capability module
> that has no caller, and `tests/batch.test.ts` asserts the grading function
> never overstates a guarantee — including the case where the unwind loop dies
> part-way and a naive "every unwind succeeded" check would report flat while a
> leg is still open.

**Range / Spread / Ladder — the venue cannot express them.**
Each needs 2+ strikes on one expiry. Re-verified live while writing this: across
**548 markets**, the most distinct strikes on any single expiry is **1**. This is
no longer a paragraph — [`sdk/venue/structures.ts`](sdk/venue/structures.ts)
decides it from the registry, `/structures` and `/docs` print the counts they
were decided from, and `tests/structures.test.ts` asserts the verdict *flips* the
day a second strike appears.

**A live successor roll — venue-dependent, and the instrument is now real.**
The planner and daemon share the verified execution path. What was missing is a
successor: the venue does not pre-strike them, so the window in which one exists,
is struck and has a resting offer is short and unpredictable.
[`scripts/roll-watch.ts`](scripts/roll-watch.ts) was a parallel implementation —
it hard-coded the tick grid and read the SDK's own receipt field as the verdict,
so a success there proved nothing about PRISM. It now calls `planRoll` /
`executeRoll` directly, sits on the venue for as long as you tell it to, and
writes `docs/evidence/roll-receipt.json` on a chain-verified roll.

```bash
PRISM_DRY_RUN=false ROLL_WATCH_MINUTES=120 \
  bun --conditions react-server scripts/roll-watch.ts
```

Still open: no successor has appeared during polling, so the receipt does not
exist yet. That is the venue's behaviour, not a gap in the roll path.

---

## The verified round trip

```
buy     0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e
        1 YES at 0.886 tUSDC
        market resolved YES
redeem  0x1b21a41150cd019ca1fdc1472f416563de7e3a6158499e4b1844aa0cfc793206
        block 471,513,467 · receipt 0x1

tUSDC   499.114000 → 500.114000            net +0.114000
```

[`/proof`](https://prism-terminal-cyan.vercel.app/proof) re-reads both
transactions from Somnia on every request — receipt status, block, sender, and
the collateral movement **decoded from the transfer logs**. Only the two hashes
are constants. If the chain stopped agreeing, the page would say so.

---

## Architecture

```
                        User
                          |
              +-----------+-----------+
              v                       v
     Wallet (RainbowKit)        PRISM web (Vercel)
     user's own key                   |
              |                       v
              |            backend/market-data     no key -> scales out
              |            backend/executor        SINGLE WRITER, one key
              |            backend/roll            the daemon
              |                       |
              +-----------+-----------+
                          v
                       sdk/
              venue/ · dreamdex/ · quant
                          |
              @somnia-chain/markets-sdk
                          |
                   Somnia Shannon
                          |
              VERIFICATION: raw RPC, independent of the SDK
                          |
                  Shannon explorer
```

```
backend/executor/     owns the key — serialized queue
backend/market-data/  read fan-out — no key
backend/roll/         the roll + claim daemon
contracts/            addresses + ABIs of the contracts PRISM calls
sdk/                  venue, dreamdex, quant — shared, React-free
src/                  the Next.js app
docs/                 architecture · gotchas · demo
tests/                80 tests
```

`contracts/` documents the DreamDEX contracts PRISM *talks to* — addresses,
ABIs, and the transactions that verified each one. **PRISM deploys none of
them**; it is a client. See [`contracts/README.md`](contracts/README.md).

---

## Two signing paths

| | Custody | Nonce | Ceiling |
|---|---|---|---|
| **Wallet connected** | user's key | user's own | none |
| Demo burner | server key, guarded | one shared | ~1 tx globally |

Nonces are sequential, so a single server key means every trade in the system
contends for one nonce. Connecting a wallet removes that entirely.

The split of responsibility matters:

- **Server owns the arithmetic.** Price and size snap to the venue's integer
  tick and lot grid before anything reaches the browser, so a float never
  reaches an 18-decimal venue. That must not depend on the client.
- **Client owns the key.** It receives `to`, `data`, `value` and signs. No
  private material crosses the boundary in either direction.

The SDK **returns** the approval and never sends it — skipping it reverts
on-chain — so it is sent first and awaited before the order.

---

## Why the SDK response is not the truth

The DreamDEX bot kit documents that a write **can resolve without throwing even
when the transaction reverted**. A `success` flag is therefore evidence, not a
verdict.

`verifyExecution()` never reads it. It re-derives the outcome from chain via raw
RPC:

1. `eth_getTransactionReceipt` — authoritative when a hash exists
2. `eth_getTransactionCount` — nonce movement proves something was broadcast
3. `balanceOf(tUSDC)` — a real delta proves collateral moved

It may answer **`UNKNOWN`**, and the UI renders `UNKNOWN` as `UNKNOWN`. An
explorer link is built only from a hash that survived verification.

---

## Performance

Measured, before and after:

```
getMarketSnapshot()   1245-4876ms, uncached, on EVERY page render
                      -> ~50k GraphQL queries at 50k users

/markets   req 1  5.996s   (cold)
           req 6  0.053s   (cached)          112x
/trade     1.120s -> 0.452s
/roll      817 KB -> 104 KB
```

Registry pulls at 50k users: **~6/min**, not 50,000. TTLs are set against how
fast the data can change — windows are minutes long, so a 10s-stale registry is
still correct, and countdowns tick client-side from the snapshot's own
`fetchedAt` so a cached snapshot shows a *correct* clock.

Never cached: anything that signs, and anything per-wallet. A stale balance is a
wrong trade.

---

## Security

- No key ever reaches the browser; `.env*` is gitignored and CI scans full
  history for key literals
- `server-only` on every module that can move funds
- Rate limit per caller, plus an **on-chain spend floor** that holds across
  serverless instances where in-memory limits cannot
- Server-side order size cap — a limit that only exists in an input's `max`
  attribute is not a limit
- Mandatory order expiry, capped at the market's own
- IOC by default, so no remainder rests with escrow locked

---

## Testing

```
tests/quant.test.ts         payoff boundaries, PAVA repair, depth limits
tests/grid.test.ts          reproduces the 18-decimal bug, then proves the fix
tests/routability.test.ts   expiry headroom, struck/unstruck, status gating
tests/structures.test.ts    the one-strike constraint, AND that it flips
tests/batch.test.ts         the grading function, incl. the unwind-died case
tests/deploy-config.test.ts tracing root, route coverage, no uncalled modules
```

80 tests, all pure — no mocked blockchain. Live behaviour is verified manually
against Shannon and recorded above; that is stated separately rather than dressed
up as integration coverage.

The grid tests matter most: the 18-decimal failure is **invisible on a 6-decimal
testnet**, so a happy-path test would pass against broken code. They assert the
failure first.

`structures.test.ts` is the second-most important, for the opposite reason. It is
easy to write a test that agrees the venue has one strike; the useful assertions
are the ones proving Range and Spread turn **on** at two strikes and Ladder at
three. A constraint that can only ever answer "no" is indistinguishable from a
hard-coded no.

---

## Local development

```bash
bun install
cp .env.example .env.local
bun run dev                    # http://localhost:3177
```

```bash
bun run typecheck
bun run test
bun run build

bun run svc:market-data        # :8082  no key
bun run svc:executor           # :8081  needs PRIVATE_KEY
bun run svc:roll               # the daemon
docker compose up              # all three
```

Live diagnostics:

```bash
bun scripts/probe-venue.mjs        # discovery + venue scoping
bun scripts/probe-exec.ts          # balances, order book (places NO order)
bun --conditions react-server scripts/verify-markets.ts
```

## Environment

Names only; never commit values.

| Variable | Purpose |
|---|---|
| `PRISM_NETWORK` | `testnet` or `mainnet` |
| `PRISM_INDEXER_URL` | GraphQL indexer — **not** the RPC url |
| `PRISM_RPC_URL` | Somnia JSON-RPC |
| `PRISM_DRY_RUN` | `true` blocks all signing; only `false` arms it |
| `PRIVATE_KEY` | demo signer. Burner holding testnet value only |
| `PRISM_MAX_ORDER_CONTRACTS` | server-side per-order cap |
| `PRISM_RESERVE` | collateral floor for the shared demo wallet |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | optional; injected wallets work without it |

> The indexer URL is a different host from the RPC. Passing the RPC where the
> indexer belongs fails with `RegistryMarkets failed: empty response`, which
> reads like an outage rather than a config mistake.

---

## Venue behaviour we design around

Eight gotchas, each **reproduced live** rather than cited — one strike per
window, `loadMarkets` hiding your winnings, the 18-decimal float bug, silent
reverts, unstruck successors, taker-pays-fill. See
[`docs/gotchas.md`](docs/gotchas.md).

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — the read/write split
- [`docs/gotchas.md`](docs/gotchas.md) — venue behaviour, reproduced
- [`docs/demo.md`](docs/demo.md) — 2:30 script

---

## Stack

Next.js 15 · React 19 · TypeScript (strict) · Tailwind v4 ·
`@somnia-chain/markets-sdk` · viem · wagmi · RainbowKit · lightweight-charts ·
Geist Mono · Vitest · Bun · Docker

---

*Testnet build. Educational reference, not financial advice.*
