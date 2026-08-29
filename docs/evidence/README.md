# Evidence

Artifacts written by a probe against the **live** venue. Nothing in this
directory is authored by hand, and nothing here is generated unless the thing it
describes actually happened.

| File | Written by | Written when |
|---|---|---|
| `roll-observations.jsonl` | `scripts/roll-watch.ts` | every sweep, always |
| `roll-receipt.json` | `scripts/roll-watch.ts` | only on a chain-verified roll |

## Why the negative log exists

`roll-receipt.json` is written only when `executeRoll` returns
`VERIFIED_EXECUTED`. That makes an empty directory ambiguous in exactly the way
this repository tries never to be: it cannot distinguish

- the venue never listed a rollable successor, from
- nobody ever ran the watcher.

The README asserted the first. Nothing here could prove it.

`roll-observations.jsonl` closes that. One line per sweep, appended whether or
not anything was rollable:

```json
{"at":"2026-08-29T...","sweep":12,"network":"testnet","live":8,"planned":16,"rollable":0,"blockers":{"NO_SUCCESSOR_LISTED":16}}
```

So "no successor has appeared during polling" becomes a count of sweeps with a
timestamp on each, and the day one does appear, the line immediately before the
receipt shows how long the wait was.

## Reproducing

Watching only, nothing signed:

```bash
ROLL_WATCH_MINUTES=120 bun --conditions react-server scripts/roll-watch.ts
```

Armed — will sign and send if a rollable successor appears:

```bash
PRISM_DRY_RUN=false ROLL_WATCH_MINUTES=120 \
  bun --conditions react-server scripts/roll-watch.ts
```

Exit codes: `0` a successor was found (and rolled, when armed), `2` the watch
window elapsed with none listed.

## The current state of the claim

Reproduce it directly at any time:

```bash
bun --conditions react-server scripts/probe-succession.ts
```

It prints a machine-readable verdict line. As of the last run, every live market
reported `exact:NO label:NO` — no successor by either the exact-seconds match or
the venue's own cadence label, so the absence is the venue's, not a matching bug
in `successionChain`.

---

## `ec-oracle-follow` — chain-verified fills

`oracle-follow-run.log` holds the signal and fill lines from an armed run:
246 ticks, 3 signals past the 0.03 edge, 2 fills verified from chain.

| | leg | oracle vs strike | fair | ask | edge | tx |
|---|---|---|---|---|---|---|
| tick 210 | BTC 5m NO | 77622.98 vs 77624.25 | 0.496 | 0.435 | 0.0691 | [`0x40c5e0…`](https://shannon-explorer.somnia.network/tx/0x40c5e012f48342c55501735c7ca203aa915a88330e7de75b4cb05250dcdd2381) |
| tick 237 | ETH 5m YES | 2436.62 vs 2436.61 | 0.500 | 0.398 | 0.1022 | [`0xa70ddb…`](https://shannon-explorer.somnia.network/tx/0xa70ddb8f77705380505b336c1fd84f37bbbaa20da89f51b4ac4bb0fc2f170535) |

Blocks 474,163,034 and 474,169,231, both `status success`.
Re-derive them yourself, without the bot or the SDK:

```bash
bun --conditions react-server scripts/verify-oracle-fills.ts
```

### The third signal is the one worth reading

At tick 19 the edge cleared (0.0336) and the order **reverted**:

```
tick 19  SIGNAL  BTC 5m NO  spot 77412.68 vs strike 77417.99
         fair 0.480  ask 0.486  edge 0.0336
tick 19  failed: placeBinaryOrder reverted: ImmediateOrCancelNoFill()
```

The resting offer moved between the book read and the fill, and IOC did exactly
what it is for — took nothing rather than resting size in a window minutes from
expiry. Three signals, two fills: the strategy is **not** reported as 3/3, and
the miss is in the log next to the successes. A runner that counted its own
intent as a fill would have claimed three.

---

## `executeBatch` and `cancelOrders` — live, and the batch failed usefully

Both were fully written, unit-tested, and had **never sent a transaction**. A
library nobody has run is a claim, not a capability.
`scripts/prove-batch-cancel.ts` drove both against the live venue;
`batch-cancel-receipt.json` is its output.

### The batch graded itself `PARTIAL_UNWOUND`

Two legs, both with a resting offer at plan time:

```
leg ETH-243228-29AUG26-0855#YES  ask 0.687
leg BTC-7758150-29AUG26-0855#YES ask 0.719

atomicity  PARTIAL_UNWOUND        cost 1.406   18.7s
leg FILLED   filled 1  0x88143073c903cedbfe6d995678079160b72683af150b234246f17bbaeaf77f84
leg FAILED   filled 0  (none)
unwind UNWOUND        0xb3b6bbbda76d7ee83312abb95535c172c504e6abc87d3c3d944e7fdeea48ac6c
```

**This is better evidence than a clean fill.** The book moved between two
sequential transactions — exactly the window `batch.ts` documents as the reason
this is *not* atomic — the first leg was already on, and the unwind sold it back
and verified the sale from chain. The result is reported as `PARTIAL_UNWOUND`,
never as success. Had the unwind also failed it would read `PARTIAL_EXPOSED`,
and the position would still be one-sided.

### The cancel re-read the book rather than trusting the receipt

```
post-only ETH-243228-29AUG26-0855#YES @ 0.05
  orderId 92233720368547791592   0xf38a40c7e365d607635435759c9a1ad5bdec8399d89eceac60f81e4831f1812f
  resting before cancel: 1
  cancel VERIFIED_CANCELLED      0x3cb368aa8aeefe045439230895087f07a68fa899945b1d66b551b81c3b8eca79
         receipt.status=success block=474205273
         none of the 1 targeted orders are resting any more
  resting after cancel: 0        (re-read from chain)
```

The last two lines are the point. A green receipt says the transaction executed,
not that every id in it was pulled — a batch cancel skips stale ids silently. So
what is still resting comes from `getOwnOpenOrdersOnchain`, not from the receipt
and not from the indexer, whose order view lags chain head.

### Reproduce

```bash
PRISM_DRY_RUN=false bun --conditions react-server scripts/prove-batch-cancel.ts
```

It waits for a routable window rather than concluding from an empty board —
reporting "skipped" between windows would record the venue's schedule as if it
were a limitation of these paths.
