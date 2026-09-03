<div align="center">

<img src="docs/screenshots/landing.jpg" alt="PRISM — strategy infrastructure for DreamDEX Event Contracts" width="100%" />

<br />
<br />

[![CI](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml/badge.svg)](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-256%20passing-10b981)
![Network](https://img.shields.io/badge/network-Somnia%20Shannon%2050312-1f1f23)
![Stack](https://img.shields.io/badge/Next.js%2015%20·%20React%2019%20·%20TypeScript%20strict-1f1f23)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

### Strategy infrastructure for DreamDEX Event Contracts.

DreamDEX Event Contracts expire every few minutes. PRISM turns those ephemeral contracts into positions with a real tenor — reading live markets from Somnia, executing against them, verifying the result independently of the SDK, settling, and carrying a view into the successor window.

**Core guarantee: no simulated data anywhere. Every number in this README is read from the chain or reproduced locally.**

### [▶ Live terminal](https://prism-terminal-cyan.vercel.app) · [On-chain proof](https://prism-terminal-cyan.vercel.app/proof) · [Verify the batch](#the-50-account-on-chain-batch) · [Architecture](#architecture)

[The problem](#the-problem) · [What is real](#what-is-real) · [The 50-account batch](#the-50-account-on-chain-batch) · [Architecture](#architecture) · [Engineering decisions](#engineering-decisions) · [Security](#trust-security-and-privacy)

</div>

---

## The problem

An Event Contract is a cash-or-nothing digital: it pays 1 tUSDC if the underlying finishes above a strike at window close, 0 otherwise. A real derivatives primitive.

It is also **extremely short-lived**. Routable windows are minutes long, and the venue does not pre-strike successors — measured across all twelve live chains, every one reported *no successor listed* for seventeen minutes straight. A trader wanting exposure beyond one window must rediscover, re-strike and re-enter continuously, by hand, forever.

| Problem | Impact |
|---|---|
| Windows expire every few minutes | No holding period; a position cannot outlive one window |
| No pre-struck successors | Exposure dies at window close; re-entry is manual and endless |
| One strike per window | No ladder, no range, no spread — no composition across strike |
| SDK responses can lie | A write can resolve without throwing even when the tx reverted |
| 18-decimal price grid | Float probabilities land off-tick; the venue rejects them |
| Cached markets go stale | The board empties between windows; a cached list hides real markets |

PRISM exists to remove that.

## What is real

Everything below executes against Somnia and is independently verifiable. **There is no simulated data anywhere in this repository.**

| Capability | Evidence |
|---|---|
| Market discovery | 572 binary markets from the Somnia indexer, every underlying it lists |
| Normalization | `UnifiedMarket` → typed `EventMarket` at one boundary, with every discarded row counted by reason |
| Routability | struck / unstruck / expired / inside-headroom, from chain fields |
| Oracle prices | live BTC & ETH from Somnia's on-chain EMA feed |
| OHLC candles | real 1m/1h/1d, charted with TradingView's `lightweight-charts` |
| **Execution** | signed, mined, verified — see the batch below |
| **Settlement** | finalized sweep, fee-aware payout, real redeem |
| **Verification** | outcome re-derived from receipt, nonce and balance delta |
| **Non-custodial signing** | RainbowKit — users sign with their own key |
| Roll planner + daemon | real succession chains, typed blockers |
| Wallet history | read from the Shannon explorer account API |

## The 50-account on-chain batch

Fifty distinct cohort wallets each placed a real `BUY_YES` order against live DreamDEX order-pool contracts on Somnia Shannon. Every hash below was re-verified against the chain (receipt status, from, to, block) after mining — no row is claimed from memory.

| # | Wallet | Order tx | Explorer | Pool | Block | Status |
|---|---|---|---|---|---|---|
| 1 | `0xd8A880…c03A` | `0x047e2f607fa9…` | [view](https://shannon-explorer.somnia.network/tx/0x047e2f607fa998f601dd9a63c0ad9cb41871777ee76689414ad0f512b6918421) | `0x3e35f705…` | 476660023 | success |
| 2 | `0x23Ce19…3021` | `0xbaec39baf84e…` | [view](https://shannon-explorer.somnia.network/tx/0xbaec39baf84ea41e01e473e4655bab428cdb587082a056d86ad28dee5147dff5) | `0x778c14b1…` | 476641070 | success |
| 3 | `0x876096…525e` | `0xe5b7cea28f10…` | [view](https://shannon-explorer.somnia.network/tx/0xe5b7cea28f10920c515e02b5fa2c35ca917aadab5de68cf62cccee47d68ba446) | `0x1569440e…` | 476660754 | success |
| 4 | `0x7BAAa5…7C3A` | `0xc30e788b6d3e…` | [view](https://shannon-explorer.somnia.network/tx/0xc30e788b6d3e1bc3ae7743e3add7d56fff6e597acf7e462f23aa0fb8bee717d2) | `0x4143cd6d…` | 476660967 | success |
| 5 | `0xcaE490…0Cc3` | `0x040d5d877980…` | [view](https://shannon-explorer.somnia.network/tx/0x040d5d877980d0327ebfb8e77cb8e0ce97f24f2685df49d23d6875ef1ba0832c) | `0x610fa91f…` | 476641377 | success |

Full list of all 50 wallets and their order transactions is kept locally (`50-tx-full-list.md`).

## Why DreamDEX specifically

The venue lists **one strike per window** and five cadences per asset. That kills composition across strike — no ladder, no Range, no Spread, no risk-neutral density — and makes composition across **time** the only real axis. PRISM is built on the axis the venue actually has, not the one a generic options UI assumes.

## Architecture

```
EVENT CONTRACT → STRATEGY → RISK → EXECUTION → VERIFICATION → SETTLEMENT → CONTINUITY
```

```text
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 15)                                              │
│  terminal · positions · settlement · /proof (re-read from chain)     │
└───────────────┬─────────────────────────────────────────────────────┘
                │ server-only
┌───────────────▼─────────────────────────────────────────────────────┐
│  SDK (sdk/dreamdex)                                                 │
│  execution.ts   — validate → submit → verify (receipt-derived)      │
│  place-limit.ts — integer-grid order placement (18-decimal safe)    │
│  proof.ts       — /proof re-verifies lifecycle from chain per hit   │
│  roll.ts        — succession planning across windows                │
└───────────────┬─────────────────────────────────────────────────────┘
                │ viem + @somnia-chain/markets-sdk
┌───────────────▼─────────────────────────────────────────────────────┐
│  SOMNIA SHANNON (chain 50312)                                       │
│  indexer (GraphQL) · RPC · on-chain EMA oracle · order pools        │
└─────────────────────────────────────────────────────────────────────┘
```

### Transaction flow

1. **Discover** — 572 binary markets read from the Somnia indexer.
2. **Normalize** — every row mapped to a typed `EventMarket`; discarded rows counted by reason.
3. **Validate** — struck, trading, outside expiry headroom, size within cap, collateral sufficient. Rejection here costs nothing; on-chain it costs gas.
4. **Submit** — IOC order through the integer grid tier; `placeBinaryOrder` escrows tUSDC to the pool.
5. **Verify** — outcome re-derived from the receipt, nonce and balance delta. The SDK's response is evidence, not truth; UNKNOWN is never rendered as success.
6. **Settle** — fee-aware payout, real redeem against the settlement singleton.
7. **Continue** — the roll planner carries the view into the successor window.

## Engineering decisions

### The SDK response is not the truth

The bot-kit documents that a write can resolve without throwing even when the underlying transaction reverted. `verifyExecution` re-derives the outcome from chain state — receipt status, nonce movement, collateral balance delta — and is allowed to answer UNKNOWN. UNKNOWN is never rendered as success.

### The 18-decimal grid bug is invisible on testnet

`createOrder` hands a float to `parseUnits`. At 18 decimals that exposes the float's binary representation: `(0.05).toFixed(18)` is `0.050000000000000003` — three wei off the tick grid, which the pool rejects with `InvalidPrice`. A 6-decimal venue never shows this, which is why Shannon testnet is clean and mainnet is not. So no float ever reaches the SDK here: price and size are converted in TICK and LOT units as exact bigints.

### One strike per window is a constraint, not a bug

The venue lists one strike per window. That kills composition across strike — so composition across **time** is the axis. PRISM's roll converts a five-minute contract into a position; carrying a view across window succession is what turns a one-time click into a returning trader.

### The indexer URL is not the RPC URL

Passing the RPC where the indexer belongs fails with `RegistryMarkets failed: empty response`, which reads like an outage rather than a config mistake. The SDK takes both, and `resolveVenueConfig` keeps them distinct.

### Makers create the depth the board is missing

All six bot-kit strategies run on PRISM's verified path, three of them resting — maker, passive bid, ladder. More makers is more depth, and more depth is what makes the venue tradeable for everyone who arrives after.

## Trust, security, and privacy

- **No key ever reaches the browser** — `.env*` is gitignored and CI scans full history for key literals.
- **`server-only` on every module that can move funds.**
- **Split-key operation** — `PRIVATE_KEY` is the hot operator; `OWNER_ADDRESS` is the fund wallet. Orders route via `placeOrderFor`; the hot key can never withdraw.
- **Server-side order size cap** — a limit that only exists in an input's `max` attribute is not a limit.
- **Mandatory order expiry**, capped at the market's own — an un-expiring order outlives a crashed process.
- **IOC by default** — no remainder rests with escrow locked.
- **On-chain spend floor** that holds across serverless instances where in-memory limits cannot.

## Implementation status

| Capability | Status | Current behavior |
|---|---|---|
| Market discovery + normalization | Implemented | 572 markets, typed boundaries, discarded rows counted |
| Routability gating | Implemented | struck/unstruck/expired/headroom from chain fields |
| Execution (IOC) | Implemented | real fills, escrow to pool, receipt-verified |
| Verification | Implemented | re-derived from receipt + nonce + balance delta |
| Settlement | Implemented | fee-aware payout, real redeem |
| Non-custodial signing | Implemented | RainbowKit, users sign their own key |
| Roll planner + daemon | Implemented | succession chains, typed blockers |
| 50-account batch proof | Implemented | 50 distinct wallets → live pools, all verified |
| Mainnet grid safety | Implemented | integer tick/lot tier; 18-decimal safe by construction |
| Mainnet deployment | Not shipped | testnet-only; mainnet grid work exists *because* it differs |
| Successor pre-striking | Not shipped | venue's problem; the roll waits for it |

## Technology and repository layout

### Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| Web | Next.js 15, React 19, Tailwind v4 |
| Chain | Somnia Shannon (50312) via `@somnia-chain/markets-sdk` + viem |
| Wallet | wagmi, RainbowKit |
| Charts | TradingView `lightweight-charts` |
| Tests | Vitest (256 passing) |
| Runtime | Bun, Docker |

### Repository layout

```text
frontend/     Next.js app — terminal, positions, settlement, /proof
sdk/          venue config, execution, place-limit, roll, proof, settlement
backend/      market-data / executor / roll services
contracts/    addresses + ABIs of the DreamDEX contracts PRISM calls
scripts/      probes, verify-claims, demo scripts
tests/        pure unit tests — no mocked blockchain
docs/         architecture, gotchas (reproduced live), evidence
```

## Run the deterministic proof

The fastest way to evaluate PRISM is the live terminal — but the strongest claim is the verification path, which re-reads every transaction from the chain on each request:

```bash
bun install
cp .env.example .env.local
bun run dev                    # http://localhost:3177
```

```bash
bun run typecheck
bun run test                   # 256 tests, all pure — no mocked blockchain
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
bun scripts/verify-claims.ts       # re-checks every README claim against chain
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
| `OWNER_ADDRESS` | fund wallet; the hot key can never withdraw |
| `PRISM_MAX_ORDER_CONTRACTS` | server-side per-order cap |
| `PRISM_RESERVE` | collateral floor for the shared demo wallet |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | optional; injected wallets work without it |

> The indexer URL is a different host from the RPC. Passing the RPC where the indexer belongs fails with `RegistryMarkets failed: empty response`, which reads like an outage rather than a config mistake.

## Tests and CI

The Vitest run passes **256 tests across 14 files**, all pure — no mocked blockchain. Live behaviour is verified manually against Shannon and recorded above; that is stated separately rather than dressed up as integration coverage.

| File | Covers |
|---|---|
| `quant.test.ts` | payoff boundaries, PAVA repair, depth limits |
| `grid.test.ts` | reproduces the 18-decimal bug, then proves the fix |
| `routability.test.ts` | expiry headroom, struck/unstruck, status gating |
| `structures.test.ts` | the one-strike constraint, AND that it flips |
| `batch.test.ts` | the grading function, incl. the unwind-died case |
| `deploy-config.test.ts` | tracing root, route coverage, no uncalled modules |
| `discovery.test.ts` | a THIRD underlying survives normalization |
| `wallet-config.test.ts` | no placeholder credential reaches the relay |
| `bot-kit.test.ts` | the kit's six strategy names, and the Builder's |

The grid tests matter most: the 18-decimal failure is **invisible on a 6-decimal testnet**, so a happy-path test would pass against broken code. They assert the failure first.

GitHub Actions runs install → typecheck → test → build on every push; the latest runs are green.

## Known limitations

PRISM is a working technical demonstration on testnet, not a finished deployment:

- **Testnet only.** Mainnet grid work exists because it will differ — the 18-decimal tier is built and tested, but no mainnet position has been opened.
- **The venue does not pre-strike successors.** The roll planner is built and waiting; 0 successors were observed in ~300 recorded sweeps.
- **Agents trade on the verified path**, but nobody has run one at scale.
- **Makers need the spread to cover venue fees** — fee capture is native, but quoting profitability is unproven at volume.

These constraints are documented to keep evaluation focused on what the repository proves today: real market discovery, verified execution, receipt-derived settlement, and a 50-account on-chain batch against a live venue.

## License

[MIT](LICENSE).
