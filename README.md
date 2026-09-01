<div align="center">

<img src="docs/screenshots/landing.jpg" alt="PRISM — strategy infrastructure for DreamDEX Event Contracts" width="100%" />

<br />
<br />

[![CI](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml/badge.svg)](https://github.com/Venkat5599/somnai/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-241%20passing-10b981)
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
| 6 | `0x2941eB…9f17` | `0xd9d094912f96…` | [view](https://shannon-explorer.somnia.network/tx/0xd9d094912f968ab66280ce4e1706f438bc068408f377a564a4600946995600d2) | `0x246a6564…` | 476641468 | success |
| 7 | `0x2CfC99…af4f` | `0xc04eb8e64a04…` | [view](https://shannon-explorer.somnia.network/tx/0xc04eb8e64a04117667709cbd15f6d6e1c8474ac66230aefa85ba34fdbec16898) | `0x778c14b1…` | 476662152 | success |
| 8 | `0x67F4fd…23E7` | `0x1203758be2aa…` | [view](https://shannon-explorer.somnia.network/tx/0x1203758be2aa202441d7774809fbdb5f479b0ce8c8b5b2cfc955be432a235e31) | `0x1f44b95c…` | 476641670 | success |
| 9 | `0xe3fB2b…84ff` | `0xdeaf0d379410…` | [view](https://shannon-explorer.somnia.network/tx/0xdeaf0d3794105bd7b48219bfb3606303c94866e854481d41daca228a6dadf65b) | `0xf60d9c37…` | 476634080 | success |
| 10 | `0x2cA18c…Ef48` | `0xd0cbe920cbff…` | [view](https://shannon-explorer.somnia.network/tx/0xd0cbe920cbff8c81fe0e1ec714d7b0653f9b69f132b75107dd85caf8f53f8544) | `0x246a6564…` | 476663632 | success |
| 11 | `0xE421C9…23bE` | `0x989ee7e7c0df…` | [view](https://shannon-explorer.somnia.network/tx/0x989ee7e7c0df53cbc57e9e773066a75de2576d71735da647bffa20ce7a30e44c) | `0x610fa91f…` | 476663750 | success |
| 12 | `0x18eF51…29f4` | `0x810c662a0a2c…` | [view](https://shannon-explorer.somnia.network/tx/0x810c662a0a2ccd278852592f3c4e09031308e2d9e92e7db796f24208a491f256) | `0x3e35f705…` | 476663862 | success |
| 13 | `0x920313…427b` | `0x11d7915aea91…` | [view](https://shannon-explorer.somnia.network/tx/0x11d7915aea9132d0e017edd73f7799b0eb55e4b0f02e6dde4138f5dd687a03ee) | `0x699dce5b…` | 476664006 | success |
| 14 | `0xAAbBa3…10BF` | `0x60f7df32bd19…` | [view](https://shannon-explorer.somnia.network/tx/0x60f7df32bd1931d4373f049d3d5fc9c9b40438d1d51d5dc536fe24335b295757) | `0x2e50436a…` | 476664125 | success |
| 15 | `0xf1fE06…09c2` | `0x7be74b65bd2d…` | [view](https://shannon-explorer.somnia.network/tx/0x7be74b65bd2d91df9d9a16800d71cca024133c82d03407d6d2a331d64c397ab0) | `0x4143cd6d…` | 476642686 | success |
| 16 | `0xee8565…691D` | `0xf648cdc8ac49…` | [view](https://shannon-explorer.somnia.network/tx/0xf648cdc8ac49e658b0700e4502020352b782386df177a71ac1f9a6352a1f8bbd) | `0x31fddb37…` | 476672443 | success |
| 17 | `0x0f0a9D…105d` | `0xa6507e9cc228…` | [view](https://shannon-explorer.somnia.network/tx/0xa6507e9cc2289b43d583202b8a330fd70cfcaf37e8ed23313f096d092b628649) | `0xc9801d78…` | 476672862 | success |
| 18 | `0xCD6631…C42b` | `0xd17fc3c77576…` | [view](https://shannon-explorer.somnia.network/tx/0xd17fc3c77576dc0468f0b2ea229c9d8c3284003e8a486a58f19bca2b483efabc) | `0xc9801d78…` | 476673041 | success |
| 19 | `0xb6141A…CA44` | `0x16048edc14b4…` | [view](https://shannon-explorer.somnia.network/tx/0x16048edc14b4376397d41648beeaaac88bfdef7b332fcc35f46e11e839be7a3f) | `0xc9801d78…` | 476673138 | success |
| 20 | `0x9C5B97…dc40` | `0x8460ee83a382…` | [view](https://shannon-explorer.somnia.network/tx/0x8460ee83a38275150d567dd4dc061a655e99e806c070e2d7bd739544ce7ac1aa) | `0xd5bed053…` | 476673320 | success |
| 21 | `0x989b98…A6C9` | `0x55ebf388e4d7…` | [view](https://shannon-explorer.somnia.network/tx/0x55ebf388e4d72a8786333e75438be5ae5b2b8f08666d496e6cadc3278589f2e6) | `0xd5bed053…` | 476673420 | success |
| 22 | `0xCb6BcC…20dc` | `0xdb4d1e0f1234…` | [view](https://shannon-explorer.somnia.network/tx/0xdb4d1e0f1234d22752c77a15c56d5b96baf7b56c7e9060a81b53adbc91ef8de0) | `0xd460d2a1…` | 476678887 | success |
| 23 | `0x163042…36AE` | `0x11d0ac7f5e4f…` | [view](https://shannon-explorer.somnia.network/tx/0x11d0ac7f5e4f9ba69638910495beb62fa61f03ca442b90b2bf8a16849c822c61) | `0x4e83efca…` | 476679304 | success |
| 24 | `0x8f9ba8…64a2` | `0xc0d3e04841aa…` | [view](https://shannon-explorer.somnia.network/tx/0xc0d3e04841aaedac9fe6f1c94d05290deed6d962eb16799de693769717e0eed7) | `0xb0dc0fe3…` | 476674275 | success |
| 25 | `0x40345A…1808` | `0xe5d129d78756…` | [view](https://shannon-explorer.somnia.network/tx/0xe5d129d78756678aac1dd52b37ce86ad5d1e7a2b03e0a62bbb2c1741806a0044) | `0xb0dc0fe3…` | 476674473 | success |
| 26 | `0x6e4357…3d56` | `0x7da1515164a2…` | [view](https://shannon-explorer.somnia.network/tx/0x7da1515164a2f76ad3301c78b3bb292981a2fd3ff407d59614107565fbb20a4b) | `0xd5bed053…` | 476674572 | success |
| 27 | `0x50a411…117b` | `0xbbbc14d4a6b7…` | [view](https://shannon-explorer.somnia.network/tx/0xbbbc14d4a6b725aa360c77cb88e158dc4c57a2cc5667d628cd3acb9de4b10ab7) | `0x1569440e…` | 476682474 | success |
| 28 | `0xb76d2A…a1E8` | `0x443154619ad4…` | [view](https://shannon-explorer.somnia.network/tx/0x443154619ad492d485f2bfb602d28d6bb803381622fdd8d933f24ce9fedca23d) | `0x4d002895…` | 476680032 | success |
| 29 | `0xcb1cC8…21E9` | `0x198c234e691a…` | [view](https://shannon-explorer.somnia.network/tx/0x198c234e691a998239b7c62075783819e36e417e551bbb6c37de78a7b16ea6fa) | `0x778c14b1…` | 476675478 | success |
| 30 | `0x68fAd3…f504` | `0x51638b2fc1f1…` | [view](https://shannon-explorer.somnia.network/tx/0x51638b2fc1f1452f1c61e10779cc2c4adb0b2246cd484f20d0c06554931054cb) | `0xefa394da…` | 476675689 | success |
| 31 | `0x865Fb6…fc4B` | `0xa7fca0007211…` | [view](https://shannon-explorer.somnia.network/tx/0xa7fca0007211f21eefce92722153abb0b67ab10a09efd338d8c68f2320964919) | `0x1531ed14…` | 476675787 | success |
| 32 | `0x59067f…2e0B` | `0x47d40b931e52…` | [view](https://shannon-explorer.somnia.network/tx/0x47d40b931e5201bedbc7993149a2204330167298efe43907c840208c9538a62f) | `0x1531ed14…` | 476675954 | success |
| 33 | `0xD70CFC…963A` | `0x5e2b76a141d5…` | [view](https://shannon-explorer.somnia.network/tx/0x5e2b76a141d53bf051315515e4dd508c36bad3bb0ec952dd4744d790e8b815e1) | `0x1531ed14…` | 476676115 | success |
| 34 | `0x5484F1…7B80` | `0x046d91ab8bd9…` | [view](https://shannon-explorer.somnia.network/tx/0x046d91ab8bd9fd3f7b8b6287754e8a79751b9483cb0bca0794687eef2403a73c) | `0x4d002895…` | 476682950 | success |
| 35 | `0x616a74…2a9c` | `0x3e3e470d7f0e…` | [view](https://shannon-explorer.somnia.network/tx/0x3e3e470d7f0e531f7fb948a03525c40d332afe2b478f6567b319dca23e3b5363) | `0x1569440e…` | 476680532 | success |
| 36 | `0xE28308…B453` | `0x376e36ed4f44…` | [view](https://shannon-explorer.somnia.network/tx/0x376e36ed4f44611755e156bda49d40023e92fec3105b548deaa718cd09998f6a) | `0x9a4edaa9…` | 476677132 | success |
| 37 | `0x4C00c4…3Cb3` | `0xe88a438ab953…` | [view](https://shannon-explorer.somnia.network/tx/0xe88a438ab9539cdf3701e618c412b37a0bf68456d61c14000b24bca47dcf9345) | `0x1531ed14…` | 476677479 | success |
| 38 | `0x89bC8A…C6b6` | `0x151326529dc8…` | [view](https://shannon-explorer.somnia.network/tx/0x151326529dc8ee4d47ac10d76407ad333f43235901870e03264f77db254d2843) | `0xb4cea3f5…` | 476677674 | success |
| 39 | `0xcA4a51…2B89` | `0xf44c7f4fe1ae…` | [view](https://shannon-explorer.somnia.network/tx/0xf44c7f4fe1ae1ec66d131aca18db0c18c78f05eac393685eb7c3f625675b071c) | `0xb4cea3f5…` | 476677849 | success |
| 40 | `0xc4ad98…6fa4` | `0x21f01291f57d…` | [view](https://shannon-explorer.somnia.network/tx/0x21f01291f57da0f857e0cef379e0ff4aa40554dc2ed27d2bf58f0f10a5094aa3) | `0xb4cea3f5…` | 476677947 | success |
| 41 | `0xf04cA4…4b63` | `0x8bc046024cbb…` | [view](https://shannon-explorer.somnia.network/tx/0x8bc046024cbb18f267857af4e92c92e1c1dcde7394a9fbfa4f4d6fbc5bac099c) | `0x1531ed14…` | 476678055 | success |
| 42 | `0xB17f43…669D` | `0x1cd10fc07a77…` | [view](https://shannon-explorer.somnia.network/tx/0x1cd10fc07a77a69848b9b39b46f2b5c6d201c3b9a4336ba95a399fd814534393) | `0x37ea2f36…` | 476678219 | success |
| 43 | `0xA3C698…1288` | `0x993997cd052e…` | [view](https://shannon-explorer.somnia.network/tx/0x993997cd052ec3737259ea35ca6a7eb62930ecf894a301a6bbfb53273c14870f) | `0x37ea2f36…` | 476678517 | success |
| 44 | `0xb25043…7a30` | `0x52ccf568b0f3…` | [view](https://shannon-explorer.somnia.network/tx/0x52ccf568b0f349d8edcf7fc0f1a8d1fce0c6a33c15a9e578517b4de1682b02af) | `0x1569440e…` | 476680714 | success |
| 45 | `0x378557…d2c3` | `0x5b75f214559e…` | [view](https://shannon-explorer.somnia.network/tx/0x5b75f214559e28b5841da61ac072d4132802475157ce94b4ceb2fc3dfc49a343) | `0x4d002895…` | 476683084 | success |
| 46 | `0x072A34…66eA` | `0xbdec8e3a9419…` | [view](https://shannon-explorer.somnia.network/tx/0xbdec8e3a9419d1588313935f0d1a758aba6f62515bdca3e6295a6d4144e03c4c) | `0xd48676d2…` | 476681203 | success |
| 47 | `0x515491…A74e` | `0x59de69c0581e…` | [view](https://shannon-explorer.somnia.network/tx/0x59de69c0581eb706dfd615ed3a18af5f3e6e6fa7abfadd56c9c2f6f4b6b21790) | `0xd48676d2…` | 476681405 | success |
| 48 | `0x12445A…9B2D` | `0xbf0bd8a94c11…` | [view](https://shannon-explorer.somnia.network/tx/0xbf0bd8a94c114f11020caf3ab15dbb6e4e285ab9cf672eeb2568f2d27039eb3c) | `0xd48676d2…` | 476681514 | success |
| 49 | `0x3c5eae…374D` | `0xe0fe9c1ade96…` | [view](https://shannon-explorer.somnia.network/tx/0xe0fe9c1ade960ad95a9726abbbb58d27031d24448b2208f1c9a62324046f4b5d) | `0xefa394da…` | 476681699 | success |
| 50 | `0x705978…8cAf` | `0x10ad7fd96dfa…` | [view](https://shannon-explorer.somnia.network/tx/0x10ad7fd96dfaa88022a28a666b9f03dda8783aa7a0f3b365bf72619d4b5f7397) | `0xefa394da…` | 476681807 | success |

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
| Tests | Vitest (241 passing) |
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
bun run test                   # 241 tests, all pure — no mocked blockchain
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

The Vitest run passes **241 tests across 13 files**, all pure — no mocked blockchain. Live behaviour is verified manually against Shannon and recorded above; that is stated separately rather than dressed up as integration coverage.

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
