---
project: prism-terminal
task: Close the four open items on the worklog's "Still open" list
effort: E3
phase: complete
progress: 33/34
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

- [x] ISC-1: `frontend/src/lib/wagmi.ts` contains no literal placeholder project id
- [x] ISC-2: A WalletConnect project id is accepted only when it matches 32 hex chars
- [x] ISC-3: With no id set, the wallet config registers zero WalletConnect connectors
- [x] ISC-4: With no id set, injected wallets remain connectable
- [x] ISC-5: With a valid id set, the WalletConnect QR flow is registered again
- [x] ISC-6: The project-id validity predicate is exported and unit-tested
- [x] ISC-7: Anti: no code path passes a non-hex string to the connector factory as projectId
- [x] ISC-8: `sdk/venue/types.ts` no longer declares `Asset` as a two-member union
- [x] ISC-9: `KNOWN_ASSETS` exists and still names BTC and ETH for display ordering
- [x] ISC-10: `normalizeMarket` accepts a row whose asset is a third underlying
- [x] ISC-11: `normalizeMarket` still rejects a row with an empty or missing asset
- [x] ISC-12: `normalizeMarket` still rejects a non-binary row
- [x] ISC-13: `MarketSnapshot` carries a `dropped` count of rows discarded at normalization
- [x] ISC-14: `MarketSnapshot` carries an `assets` map of underlying to row count
- [x] ISC-15: A dropped row records a machine-readable reason, not just a total
- [x] ISC-16: Anti: no row is discarded without incrementing a counter the UI can read
- [x] ISC-17: `/markets` asset filter is derived from the snapshot, not a hardcoded union
- [x] ISC-18: `/analytics` renders a row for every asset present, not only BTC and ETH
- [x] ISC-19: `sdk/bot/config.ts` no longer refuses an underlying outside BTC/ETH
- [x] ISC-20: `sdk/venue/config.ts` contains no claim that exactly two venue ids exist
- [x] ISC-21: `KNOWN_VENUE_IDS` is documented as observed-once labels, never a filter
- [x] ISC-22: The landing page reads its venue id from live snapshot data, not the constant
- [x] ISC-23: Anti: no source comment asserts a venue count with a stale date
- [x] ISC-24: `scripts/probe-succession.ts` prints an explicit machine-readable verdict line
- [x] ISC-25: `verify-claims.ts` reports the successor claim as listed or absent
- [x] ISC-26: `docs/evidence/` exists with a README explaining what lands there
- [x] ISC-27: `roll-watch.ts` records a negative observation log, not only a success receipt
- [DEFERRED-VERIFY] ISC-28: `roll-watch.ts` is running against the live venue at hand-off
- [x] ISC-29: Anti: no artifact claims a roll occurred when none did
- [x] ISC-30: `docs/worklog.md` "Still open" lists only genuinely open items
- [x] ISC-31: `README.md` asset claim matches the widened type
- [x] ISC-32: `bun run typecheck` exits 0
- [x] ISC-33: `bun run test` exits 0 with a higher test count than 136
- [x] ISC-34: `verify-claims.ts` still exits 0 against the live venue

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

## Changelog

- **conjecture** — all four open items were code defects awaiting attention.
  **refuted by** — `scripts/probe-succession.ts`, run before any edit: every live
  market reports `exact:NO label:NO`, so item 1 has no code fix. **learned** —
  reproduce before classifying. Two of these items were mis-stated in the
  worklog as gaps in PRISM when one was a gap in the venue and the fix was
  evidential, not functional. **criterion now** — ISC-24..29 record the absence
  instead of asserting it.
- **conjecture** — widening `Asset` to a string closes item 3.
  **refuted by** — the reason the identical `INTERVALS` bug survived was not the
  narrow type, it was that discarding was SILENT: no counter existed, so nothing
  could show the loss. A wider type with the same silence would have failed the
  same way on the next unreadable field. **learned** — when a filter is the bug,
  the fix is the feedback loop, not the filter. **criterion now** — ISC-13..16
  demand a named reason and a tallied count, not just acceptance.
- **conjecture** — omitting `walletConnectWallet` is enough to drop the relay.
  **refuted by** — `tests/wallet-config.test.ts` threw `No projectId found` at
  module load: `metaMaskWallet` and `rainbowWallet` are dual-mode and reach for
  the relay on their mobile deep-link path. **learned** — a dependency on a
  credential is not always where the credential is named. **criterion now** —
  ISC-3 asserts ZERO WalletConnect connectors, which is what actually failed.
- **conjecture** — `sdk/bot/config.ts` refusing an unknown underlying was safe.
  **refuted by** — reading the consumers: `cfg.asset ? filter : true` means
  `null` widens to EVERY market. The "safe" rejection turned a one-market config
  into an all-market one, on a process that signs. **learned** — check what a
  sentinel means at the point of USE before treating rejection as conservative.
  **criterion now** — ISC-19, and the old test rewritten, since it had encoded
  the bug as the expectation.

## Verification

| ISC | Evidence |
|---|---|
| 1-7 | `bun run test` — `tests/wallet-config.test.ts`, 13 assertions green; grep for the placeholder returns 0 hits |
| 8-16 | `tests/discovery.test.ts`, 17 assertions green, including a third and a fourth underlying surviving |
| 13-16 | live `verify-claims.ts`: `rows PRISM could not read 9 · NOT_BINARY 9 · NO_ASSET 0 · NO_INTERVAL 0` |
| 17-19 | `bun run build` green; `/markets` and `/analytics` derive from the snapshot; `tests/bot-config.test.ts` asserts pass-through |
| 20-23 | no count asserted in `sdk/venue/config.ts`; footer prints live venue and underlying counts |
| 24-25 | `probe-succession.ts` → `VERDICT NO_SUCCESSOR_LISTED checked=2 exact=0 label_only=0`; verify-claims section 4 reports it |
| 26-27, 29-30 | `docs/evidence/README.md` + `roll-observations.jsonl`, 8 timestamped sweeps recorded, no receipt fabricated |
| 28 | DEFERRED-VERIFY — watcher running (task `b05bd29mx`, 180min, watch-only). Follow-up: arm with `PRISM_DRY_RUN=false` once the venue lists a successor |
| 31 | README capability table and test counts updated to 167 |
| 32 | `bun run typecheck` exit 0 |
| 33 | `bun run test` 167 passed / 10 files, up from 136 |
| 34 | `verify-claims.ts` exit 0 — every claim holds against the live venue |
