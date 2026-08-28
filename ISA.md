---
project: prism-terminal
task: Close the four open items on the worklog's "Still open" list
effort: E3
phase: observe
progress: 0/34
mode: algorithm
started: 2026-08-29
updated: 2026-08-29
---

## Problem

Four items sit unresolved on `docs/worklog.md` under "Still open". Each was
written honestly but none was closed:

1. **No live roll receipt.** `docs/evidence/` does not exist. `roll-watch.ts` has
   never observed a struck successor with a resting book, so the roll path has
   never been proven end to end on a real succession.
2. **WalletConnect is misconfigured.** `frontend/src/lib/wagmi.ts:46` falls back
   to the literal string `prism-terminal-local` when
   `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. That is not a valid project
   id, so Reown's relay answers 403 on every page load and the console carries a
   permanent error.
3. **`Asset` is a closed union.** `sdk/venue/types.ts:11` defines
   `Asset = "BTC" | "ETH"`, and `sdk/venue/markets.ts:113` returns `null` for any
   row whose underlying is neither. A third underlying would be discarded with no
   log, no counter and no test — the same failure class as the `INTERVALS`
   constant that already hid every 1m succession chain.
4. **`KNOWN_VENUE_IDS` has rotted.** `sdk/venue/config.ts:77` documents two venue
   ids "as of 2026-08-25". The live registry now carries four. The default is
   unfiltered so nothing is hidden today, but the comment now asserts something
   false about the venue.

## Vision

Items 2, 3 and 4 stop existing: the console is clean, an unknown underlying
survives discovery and is counted, and no constant in the repository asserts a
venue fact the venue can change underneath it. Item 1 stops being a vague "still
open" and becomes a running process with a named artifact and a probe that proves
the successor genuinely is not there — so a reader can tell "we did not try" from
"the venue did not list one".

## Out of Scope

- Manufacturing a roll receipt. No successor exists on the live venue right now
  (reproduced: eight live markets, zero successors by exact or label match). A
  receipt lands when the venue lists one and not before; fabricating, simulating
  or mocking one is the exact dishonesty this repository is built against.
- Obtaining a real WalletConnect project id. That requires an account action the
  operator must take. The fix is to make its absence cost nothing, not to invent
  a credential.
- Widening `Asset` in a way that removes the BTC/ETH paths the price feed and
  analytics genuinely depend on.
- Any change to the execution, verification or settlement paths. Those are
  proven; this task must not touch them.

## Constraints

- `server-only` stays on every module that can move funds.
- No float may reach the venue; the integer tick/lot path is untouched.
- The SDK response remains evidence, not truth — no verification logic changes.
- `bun run typecheck` and `bun run test` must both stay green.
- `scripts/verify-claims.ts` must still exit 0 against the live venue.
- No new runtime dependency.

## Goal

Close items 2, 3 and 4 with code and tests that fail if the fix regresses, and
convert item 1 from an untested assertion into a reproducible probe plus a
running watcher — leaving `docs/worklog.md` carrying only what the venue itself
still withholds.

## Criteria

- [ ] ISC-1: `frontend/src/lib/wagmi.ts` contains no literal placeholder project id
- [ ] ISC-2: A WalletConnect project id is accepted only when it matches 32 hex chars
- [ ] ISC-3: With no id set, the wallet config registers zero WalletConnect connectors
- [ ] ISC-4: With no id set, injected wallets remain connectable
- [ ] ISC-5: With a valid id set, the WalletConnect QR flow is registered again
- [ ] ISC-6: The project-id validity predicate is exported and unit-tested
- [ ] ISC-7: Anti: no code path passes a non-hex string to the connector factory as projectId
- [ ] ISC-8: `sdk/venue/types.ts` no longer declares `Asset` as a two-member union
- [ ] ISC-9: `KNOWN_ASSETS` exists and still names BTC and ETH for display ordering
- [ ] ISC-10: `normalizeMarket` accepts a row whose asset is a third underlying
- [ ] ISC-11: `normalizeMarket` still rejects a row with an empty or missing asset
- [ ] ISC-12: `normalizeMarket` still rejects a non-binary row
- [ ] ISC-13: `MarketSnapshot` carries a `dropped` count of rows discarded at normalization
- [ ] ISC-14: `MarketSnapshot` carries an `assets` map of underlying to row count
- [ ] ISC-15: A dropped row records a machine-readable reason, not just a total
- [ ] ISC-16: Anti: no row is discarded without incrementing a counter the UI can read
- [ ] ISC-17: `/markets` asset filter is derived from the snapshot, not a hardcoded union
- [ ] ISC-18: `/analytics` renders a row for every asset present, not only BTC and ETH
- [ ] ISC-19: `sdk/bot/config.ts` no longer refuses an underlying outside BTC/ETH
- [ ] ISC-20: `sdk/venue/config.ts` contains no claim that exactly two venue ids exist
- [ ] ISC-21: `KNOWN_VENUE_IDS` is documented as observed-once labels, never a filter
- [ ] ISC-22: The landing page reads its venue id from live snapshot data, not the constant
- [ ] ISC-23: Anti: no source comment asserts a venue count with a stale date
- [ ] ISC-24: `scripts/probe-succession.ts` prints an explicit machine-readable verdict line
- [ ] ISC-25: `verify-claims.ts` reports the successor claim as listed or absent
- [ ] ISC-26: `docs/evidence/` exists with a README explaining what lands there
- [ ] ISC-27: `roll-watch.ts` records a negative observation log, not only a success receipt
- [ ] ISC-28: `roll-watch.ts` is running against the live venue at hand-off
- [ ] ISC-29: Anti: no artifact claims a roll occurred when none did
- [ ] ISC-30: `docs/worklog.md` "Still open" lists only genuinely open items
- [ ] ISC-31: `README.md` asset claim matches the widened type
- [ ] ISC-32: `bun run typecheck` exits 0
- [ ] ISC-33: `bun run test` exits 0 with a higher test count than 136
- [ ] ISC-34: `verify-claims.ts` still exits 0 against the live venue

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| 1-2, 7 | static | grep wagmi.ts for placeholder literal | 0 hits | Grep |
| 3-6 | unit | validity predicate over id fixtures | all pass | vitest |
| 8-12 | unit | normalizeMarket over row fixtures | all pass | vitest |
| 13-16 | unit | snapshot shape carries dropped and assets | all pass | vitest |
| 17-19 | static | no hardcoded asset union in view, analytics, bot | 0 hits | Grep |
| 20-23 | static | no stale venue-count assertion | 0 hits | Grep |
| 24-25 | live | run probe and verify-claims | exit 0 | Bash |
| 26-29 | fs | evidence dir and observation log present | exists | Bash |
| 30-31 | doc | worklog and README re-read | accurate | Read |
| 32-34 | build | typecheck, test, verify-claims | all exit 0 | Bash |

## Features

| name | satisfies | depends_on | parallelizable |
|---|---|---|---|
| walletconnect-honest-id | ISC-1..7 | — | yes |
| asset-open-union | ISC-8..19, 31 | — | yes |
| venue-id-destale | ISC-20..23 | — | yes |
| successor-evidence | ISC-24..30 | — | yes |
| green-gates | ISC-32..34 | all above | no |

## Decisions

- 2026-08-29 — Delegation floor (E3 soft, at least 2) relaxed to 0. Show your
  math: all four fixes are surgical edits inside files already read in full this
  session; Forge or Anvil would cold-start and re-derive the same context at real
  cost with no correctness gain. Thinking floor met at four from the closed list.
- 2026-08-29 — Item 1 is confirmed venue-bound, not code-bound.
  `scripts/probe-succession.ts` reports exact:NO label:NO for all eight live
  markets, so both the exact-seconds and the venue-label match agree there is no
  successor. The fix is therefore evidence and instrumentation, never a receipt.
