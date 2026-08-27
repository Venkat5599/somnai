# Worklog — 2026-08-27

Ten commits, `b2d3de6` → `58c04e3`. Tests went **35 → 136**.

One theme runs through all of it: **the repository was making claims nobody had
checked.** Some were merely stale. Several described capabilities that could not
exist on this chain. One described a module that had no caller at all. Each fix
below replaces a written claim with something that checks itself.

---

## 1. "Planned" was doing work that "impossible" should have done

Three capabilities were documented as *not implemented*. Two turned out to be
**unreachable**, not unbuilt.

### EIP-7702 is unavailable on Somnia Shannon

Probed directly. Shannon carries **none** of Prague's system contracts, nor
Cancun's, and its headers stop at London:

| marker | address | result |
|---|---|---|
| EIP-2935 (Prague) | `0x0000F908…2935` | absent |
| EIP-7002 (Prague) | `0x00000961…7002` | absent |
| EIP-4788 (Cancun) | `0x000F3df6…ac02` | absent |

Block headers carry no `withdrawalsRoot`, `excessBlobGas` or `requestsHash`, and
only tx types `0x0`/`0x2` appear in recent blocks.

**Envelope probing does not work on this node** — it answers a malformed
type-`0x2`, a type-`0x4` and a nonexistent type-`0x7f` with the identical
`{"code":-32000,"message":"invalid transaction","data":"0x08"}`. Confirmed
against a negative control. So `sdk/venue/capabilities.ts` detects the fork by
**system-contract presence**, which is a positive signal rather than an
inference from silence.

### Range / Spread / Ladder cannot be expressed

Each needs 2+ strikes on one expiry. Re-verified live: across **548 markets**,
the most distinct strikes on any single expiry is **1**.

The reason is no longer prose. `sdk/venue/structures.ts` derives it from the
registry, `/structures` and `/docs` print the counts they were decided from, and
`tests/structures.test.ts` asserts the verdict **flips** — Range and Spread turn
on at two strikes, Ladder at three. A constraint that can only ever answer "no"
is indistinguishable from a hard-coded no.

### What replaced 7702

`sdk/dreamdex/batch.ts` delivers the guarantee 7702 was wanted for, as far as
this chain allows. It reports which of four it actually delivered — and never
the word *atomic*:

| | |
|---|---|
| `PREFLIGHT_ALL_OR_NOTHING` | every leg gated before a signature exists |
| `SEQUENTIAL_VERIFIED` | every leg filled, each verdict from its own receipt |
| `PARTIAL_UNWOUND` | a leg failed; filled legs sold back, sale verified |
| `PARTIAL_EXPOSED` | a leg failed **and** an unwind failed — size is still on |

Legs go out `FILL_OR_KILL`, so a leg exists whole or not at all and an unwind
never faces a partial.

---

## 2. The module that had no caller

`batch.ts` shipped with **no importer anywhere** while the README said *"the UI
prints it"*. Nothing printed it. Typecheck, tests and the build all pass happily
on dead code, so none of the three would ever have caught it.

Fixed by giving it a real caller (`structures/actions.ts` + the **Basket** panel
on `/structures`) and by making the failure impossible to repeat:
`tests/deploy-config.test.ts` now walks the source tree for real `from "…"`
clauses and fails any capability module with no caller.

That guard had a hole of its own — it counted `tests/` as a caller, so a module
imported only by its own test would have passed. Tests are no longer callers.

---

## 3. Bugs found by looking at the running site

Reproduced in a real browser, not inferred from code.

**`/trade` opened on an expired window** while two markets were genuinely
routable. Two causes, both timing, both exposed by the 60s windows the venue
recently started listing: `snap.routable` is computed when the snapshot is
fetched and cached for 10s (a sixth of a 1m window's life), and the selection
loop awaits a `fetchOrderBook` per market — a 60s window can close inside the
scan looking for it.

**`/structures` showed green `LIVE` beside `CLOSES IN 0m 0s`** under a
"4 ROUTABLE" header. The countdown was computed once server-side and rendered as
static text; the chip was hard-coded on. `cache.ts` already documented the right
design — countdowns tick client-side — and the trade terminal already did it.

**The one-sided-book hint aimed at nothing.** When YES was empty the panel said
"Check NO" without looking at NO. A depth scan at that moment:

```
BTC 5m  YES  ask 0.020 x 200  depth 990
BTC 5m  NO   no offer
ETH 5m  YES  ask 0.020 x 200  depth 994
ETH 5m  NO   no offer
```

YES was quoting ~990 contracts one cadence over; the panel pointed away from the
only trade available. It now checks the other book before suggesting it.

---

## 4. The crash users actually hit

> Application error: a server-side exception has occurred. Digest: 1445025839

All fourteen routes were 200 at the time. It was a **rejected server action**,
which Next renders as an opaque crash screen.

**Three of four action files had no `try/catch` at all**, and every one calls
`getMarketSnapshot` against an indexer whose timeouts are routine and documented
— the read path already degrades around them. The write path did not.

On a signing path this is worse than a wrong answer: the user cannot tell a
refusal from a transaction that may already have been broadcast. So the failure
shapes avoid overclaiming in both directions — `executeOrder` answers **UNKNOWN**
after a throw around submit/verify, never `VERIFIED_FAILED`.

The regression test that guards this initially used a regex literal that matched
nothing and reported "0 try blocks" for files just written. Replacing it with a
substring count is what exposed two genuinely unguarded actions.

---

## 5. The venue is not the table the config described

`INTERVALS` listed five cadences. The live board carries **51 markets at 60s**
plus a tail of one-off windows: 6s, 45s, 47s, 52s, 56s, 59s, 89s, 92s, 176s,
540s, 542s, 898s, 899s, 3163s, 3164s.

- `/structures` **iterated that constant**, so every 1m succession chain was
  invisible there while the trade terminal bound to one happily.
- `successionChain` matched exact `intervalSec`. The venue lists "15m" at
  **898, 899 and 900** seconds — one series split into three chains, so a 900s
  position could not see an 899s successor. It now matches the venue's own label.

To be precise about what this does *not* explain: it is not why no successor has
appeared. A label match finds none either.

---

## 6. dreamBot Builder, integrated

Walked [the Builder](https://dreambot-builder.vercel.app) end to end. It is a
four-step wizard over an Event Contracts track and emits **exactly one artifact
— a `.env` block**. So the integration is a **loader**, not a dependency.

```bash
cp bot.env.example bot.env      # or paste the Builder's block
bun run svc:bot bot.env
```

| Builder strategy | runner |
|---|---|
| EC Starter | `runStarter` — crosses the spread, verified IOC |
| EC Settlement | `runSettlement` — `findClaimable` + fee-aware `claim` |
| EC Market Maker | `runQuoting` — post-only bid and ask around fair |
| EC Passive Bid | `runQuoting` — one post-only bid |
| EC Ladder | `runQuoting` — post-only grid, flattened before expiry |

**The key is deliberately not parsed.** The block carries a `PRIVATE_KEY` line;
the parser reads every other key and drops that one, reporting only whether a
usable key is *present*. Config objects get logged and serialised into errors. A
test asserts the value cannot be recovered from the parsed object or the derived
env.

Parser choices that matter more than the happy path, because a misparse does not
throw — **it trades**:

- `DRY_RUN` arms only on the exact string `false`. `no`, `0` and `off` all read
  as "not dry run" to a careless parser, and every one would start signing.
- Tuned params match by **suffix**, not the `TAKE_` prefix. Only `ec-starter` was
  walked; pinning `TAKE_` would silently fall back to defaults — a wrong size
  that trades is worse than a config that is rejected.
- A missing or unrecognised `STRATEGY` is refused outright, never defaulted.

### Order cancellation

Three strategies were refused until PRISM had it: each must *manage* a quote
after placing it, and a post-only order that can never be pulled leaves escrow
locked in a market that settles — which `loadMarkets` then hides.

`sdk/dreamdex/cancel.ts` wraps `cancelOrder` / `cancelOrders`, with two rules:

- **Open orders are read on-chain**, never from the indexer, whose order view
  lags chain head. Cancelling against a lagged list means believing you are flat
  while a quote is still resting.
- **Every cancel re-reads what is still resting.** A green receipt says the
  transaction executed, not that every id in it was pulled — `cancelOrders`
  skips stale ids silently.

`backend/bot/quoting.ts` flattens inside the expiry headroom **and on SIGINT**,
cancels before re-quoting and **aborts if anything survived** (quoting on top of
orders you failed to pull is how a maker ends up on both sides of its own book),
and only re-quotes past half a tick.

Two bugs the tests caught before any of it rested real size:

- `shouldRequote` compared floats with bare `>=`. An exactly-half-tick move
  computes as `0.0024999999999999467` against `0.0025`, so it stood pat on
  precisely the move that should re-quote — and would keep standing pat while
  fair drifted half a tick at a time, **never re-quoting at all**.
- The self-cross guard tested `bid >= ask`, which is **unreachable** given the
  edge clamps: it looked right and could never fire. The real failure is
  compression — at fair `0.996` with a `0.01` spread the ask clamps to `0.995`
  while the bid sits at `0.991`, four thousandths apart on a five-thousandth
  grid.

---

## 7. The deploy gate was breaking production to test it

- It verified **8 routes against an app with 14**, so `/structures`,
  `/analytics`, `/activity`, `/agents`, `/docs` and `/settings` were never
  requested. Routes now come from the App Router tree.
- It promoted the **production** alias and checked afterwards, so every bad
  deploy caused the outage the gate exists to prevent. Verification now runs on
  a staging alias first.
- A **200 is not a render** — a page can answer 200 with an error boundary. The
  body is now checked.
- CI's history scan expanded `git rev-list --all` into an argument list that can
  exceed `ARG_MAX`; a scan that fails to run reads as a scan that found nothing.
  Piped through `xargs`.

---

## Reproducing the claims

```bash
bun --conditions react-server scripts/verify-claims.ts    # 7702, strikes, structures
bun --conditions react-server scripts/probe-cadences.ts   # the real cadence list
bun --conditions react-server scripts/probe-succession.ts # chain fragmentation
bun --conditions react-server scripts/probe-depth.ts      # which leg is buyable
```

`verify-claims.ts` exits non-zero if the repository has started saying something
untrue about the live venue.

## Still open

- **No successor has appeared during polling**, so no roll has fired on a live
  one. `scripts/roll-watch.ts` sits on the venue and fires the same
  `planRoll`/`executeRoll` the app uses, writing a receipt when it lands. Venue
  behaviour, not a gap in the roll path.
- **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is still the placeholder** — the
  console logs `[Reown Config] … 403`. Injected wallets work; the QR flow does
  not.
- **`Asset` is `"BTC" | "ETH"`**, and `normalizeMarket` drops any row that is
  neither. If the venue ever lists another underlying, PRISM discards it
  silently — the same class of bug as the `INTERVALS` constant.
