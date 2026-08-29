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
