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
