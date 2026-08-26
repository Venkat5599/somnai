# Demo script - 2:30

Lead with `/proof`. It works regardless of market conditions.

| Time | Screen | Say |
|---|---|---|
| 0:00 | `/` | DreamDEX Event Contracts expire every few minutes. That makes a position impossible to hold. |
| 0:20 | `/markets` | 548 real markets. Routable vs unstruck, live countdowns. One strike per window, so there is no ladder to spread across. |
| 0:45 | `/trade` | Bind a real market. Payoff, max loss, liquidity-aware size. Everything derives from one market object. |
| 1:10 | **`/proof`** | **The anchor.** Buy, resolve, redeem: +0.114 tUSDC. Every field re-read from chain on load. Click *Verify independently* for the explorer. |
| 1:50 | `/roll` | Real succession chains. This is the product: one view carried across windows. |
| 2:10 | `/activity` | Real wallet history from the explorer. Every hash resolves. |
| 2:20 | close | DreamDEX provides the primitive. PRISM makes it composable across time. |

## The verified round trip

```
buy     0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e
        1 YES at 0.886 tUSDC
resolve market settled YES
redeem  0x1b21a41150cd019ca1fdc1472f416563de7e3a6158499e4b1844aa0cfc793206
        block 471513467, receipt 0x1

tUSDC   499.114000 -> 500.114000    net +0.114000
```

## If a judge asks

**Show me the transaction.** Go to `/proof`, then the explorer link.

**Is this live or cached?** `/proof` re-reads receipts per request, and the
collateral delta is decoded from the transfer logs rather than stored. Only the
two hashes are constants.

**Why no Range or Spread?** One strike per window. They are locked with the
reason shown, not faked.

**Does the roll work?** The planner and daemon are real and share the verified
execution path. It has **not** fired on a live successor, because the venue does
not pre-strike them. That is an honest gap, not a hidden one.

**Where is EIP-7702?** Not implemented. The Advanced panel says so.

## Fallback

If nothing is routable, `/trade` correctly shows *no depth* and disables Buy.
That is the honest state - do not apologise for it, point at `/proof` instead.

A demo that depends on catching a five-minute window with resting liquidity is a
demo that fails in front of a judge. This one does not depend on it.
