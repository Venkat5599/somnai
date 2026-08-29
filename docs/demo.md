# Demo script — 2:30

Verified against production immediately before writing: all routes 200, 560
registry rows, 4 venue ids, 2 routable markets.

**The one thing to check before you hit record.** Windows are minutes long and
the board empties between them. Open `/trade` first and confirm a market is
routable with more than 90 seconds left. If the board is empty, wait — the page
now binds the next window and counts down to it, so it never dead-ends, but a
live countdown films better than a pending one.

---

## 0:00 — The problem (20s)

Land on `prism-terminal-cyan.vercel.app`.

> "A DreamDEX Event Contract is a digital option that expires every few minutes.
> That is too short to be a position. To hold a view you have to rediscover,
> re-strike and re-enter, by hand, forever."

Scroll to the live board.

> "These are real markets, read from Somnia on this request. Strike, cadence,
> countdown. Nothing here is fixture data."

---

## 0:20 — What the venue actually allows (25s)

Scroll to **Everything the venue actually supports**.

> "The venue lists one strike per window. That kills composition across strike —
> no range, no spread, no ladder. So PRISM composes across time instead."

Open `/structures`.

> "And it does not just say that. It counts. 560 markets, most distinct strikes
> on any single expiry: one. Range, Spread and Ladder report as unconstructible
> from live data, and the test asserts they turn back **on** the day a second
> strike appears."

**Why this lands:** most projects hide what they cannot do. This one computes it.

---

## 0:45 — Execution and verification (35s)

Open `/trade`. Pick the routable market.

> "One strike, one leg, real book."

Point at the ticket.

> "Price and size snap to the venue's own integer tick and lot grid before
> anything is signed. A float reaching an 18-decimal venue lands off-grid and
> reverts — and that bug is invisible on a 6-decimal testnet, which is why the
> tests reproduce the failure before proving the fix."

Open `/proof`.

> "The SDK can resolve without throwing on a transaction that reverted. So the
> outcome is never read from the SDK. It is re-derived from the receipt, the
> nonce, and the collateral delta — and it is allowed to answer UNKNOWN. UNKNOWN
> is never rendered as success."

> "Buy, then redeem. Both re-read from chain on every page load. Only the two
> hashes are constants."

---

## 1:20 — The evidence that is worth showing (30s)

This is the strongest 30 seconds in the video. Do not skip it.

> "Three things ran live today."

**The batch.**

> "Two legs, both quoting. The book moved between them — the first filled, the
> second failed. The already-open leg was sold back and the sale verified. It
> reports PARTIAL_UNWOUND, not success. A clean fill would have proved less than
> this did."

**The oracle strategy.**

> "ec-oracle-follow took two fills from three signals. The third cleared the edge
> and reverted with ImmediateOrCancelNoFill — the offer moved between the book
> read and the fill, and IOC took nothing rather than resting size in a window
> about to settle. It is logged beside the two successes. Two of three, not three
> of three."

**The cancel.**

> "Placed post-only, then pulled. What was still resting was re-read from chain,
> not inferred from the receipt — a green receipt says the transaction executed,
> not that every id in it was cancelled."

---

## 1:50 — The agent (30s)

Back to the landing page. Click **Copy MCP config**.

> "PRISM runs as an MCP server. Everything this terminal does, a model can do."

Paste into Claude Desktop, restart, ask it: *"what can you trade on PRISM?"*

> "Nineteen tools. It reads the registry, prices a book, plans a roll, opens a
> structure, claims settlement."

Then ask it to place an order.

> "And it is refused. Budget, per-order cap, trade count, cooldown, market
> allowlist — and an empty allowlist permits nothing, never everything. The
> policy is fixed at process start; no tool can raise it. Dry-run is the default,
> so arming is an explicit act by the operator, never the model."

Open `/agent` briefly.

> "Copying the credential does not help either. Redeeming a grant mints a higher
> fence and invalidates the earlier holder, so two clones can never both spend."

---

## 2:20 — Close (10s)

> "Everything shown is on chain, or it is reported as not done. The roll receipt
> is still open — the venue has never listed a successor in nearly three hundred
> recorded sweeps, and that is logged as a measurement rather than claimed as a
> feature."

---

## Do not show

- **The `/settings` page** if `PRIVATE_KEY` is unset in Vercel — it will report
  no signer, which is true but reads as broken on camera.
- **A market inside its expiry headroom.** The Buy button is correctly disabled
  and it looks like a bug to someone who does not know why.
- **The hosted MCP endpoint.** The transport works and is tested, but the VPS
  deploy is unfinished. The copy-config flow is the stronger story anyway: a
  judge can run it themselves in a minute.

## If asked "what is not done"

Answer plainly, it is the strongest thing in the repo:

- No live roll — the venue has not listed a successor. Recorded in
  `docs/evidence/roll-observations.jsonl`, one timestamped line per sweep.
- EIP-7702 batching is unavailable on this chain — probed at runtime from
  Prague's system contracts, not asserted in prose.
- Mainnet is untested. The 18-decimal grid work exists *because* testnet cannot
  reveal that class of bug.
