import { describe, expect, it } from "vitest";
import { decideAtomicity } from "@sdk/dreamdex/atomicity";

/**
 * The grading function is the only part of batch execution that can lie.
 *
 * Everything else in batch.ts reports a fact — a receipt status, a fill size, a
 * blocker. `decideAtomicity` takes those facts and puts a name on the guarantee
 * delivered, and that name is what the user reads and acts on. Calling an
 * exposed position "unwound" would be worse than any bug in the execution path,
 * because it converts a known problem into an unknown one.
 *
 * These are the cases that cannot be exercised without live legs and a failing
 * venue, which is exactly why they are asserted here instead.
 */

const leg = (status: "FILLED" | "KILLED" | "FAILED" | "NOT_ATTEMPTED", filled = 0) =>
  ({ status, filled }) as const;
const unwound = { status: "UNWOUND" } as const;
const unwindFailed = { status: "UNWIND_FAILED" } as const;

describe("nothing was sent", () => {
  it("reports the preflight refusal when no leg was attempted", () => {
    expect(decideAtomicity([leg("NOT_ATTEMPTED"), leg("NOT_ATTEMPTED")], [])).toBe(
      "PREFLIGHT_ALL_OR_NOTHING",
    );
  });

  it("reports it for a single-leg refusal too", () => {
    expect(decideAtomicity([leg("NOT_ATTEMPTED")], [])).toBe("PREFLIGHT_ALL_OR_NOTHING");
  });
});

describe("everything worked", () => {
  it("reports SEQUENTIAL_VERIFIED only when every leg filled", () => {
    expect(decideAtomicity([leg("FILLED", 1), leg("FILLED", 1)], [])).toBe(
      "SEQUENTIAL_VERIFIED",
    );
  });

  it("never reports success when one leg was killed", () => {
    // A fill-or-kill that took nothing leaves the structure incomplete. The
    // user asked for two legs and has one; that is not a verified batch.
    expect(decideAtomicity([leg("FILLED", 1), leg("KILLED")], [unwound])).not.toBe(
      "SEQUENTIAL_VERIFIED",
    );
  });

  it("never reports success when a later leg was never sent", () => {
    expect(
      decideAtomicity([leg("FILLED", 1), leg("NOT_ATTEMPTED")], [unwound]),
    ).not.toBe("SEQUENTIAL_VERIFIED");
  });
});

describe("a leg failed", () => {
  it("reports PARTIAL_UNWOUND when every filled leg was sold back", () => {
    expect(decideAtomicity([leg("FILLED", 1), leg("FAILED")], [unwound])).toBe(
      "PARTIAL_UNWOUND",
    );
  });

  it("reports PARTIAL_EXPOSED when an unwind failed", () => {
    expect(decideAtomicity([leg("FILLED", 1), leg("FAILED")], [unwindFailed])).toBe(
      "PARTIAL_EXPOSED",
    );
  });

  it("reports PARTIAL_EXPOSED when one unwind of two failed", () => {
    // One recovered leg does not make the position flat.
    expect(
      decideAtomicity(
        [leg("FILLED", 1), leg("FILLED", 1), leg("FAILED")],
        [unwound, unwindFailed],
      ),
    ).toBe("PARTIAL_EXPOSED");
  });

  it("refuses to call a position unwound when an unwind was never attempted", () => {
    // The dangerous case: two legs filled, the unwind loop crashed after one.
    // Counting the single success as "all unwinds succeeded" would report flat
    // while a leg is still open.
    expect(
      decideAtomicity([leg("FILLED", 1), leg("FILLED", 1), leg("FAILED")], [unwound]),
    ).toBe("PARTIAL_EXPOSED");
  });

  it("reports no exposure when the failure came before anything filled", () => {
    // Nothing was ever held, so there is nothing to unwind and nothing at risk.
    expect(decideAtomicity([leg("FAILED"), leg("NOT_ATTEMPTED")], [])).toBe(
      "PREFLIGHT_ALL_OR_NOTHING",
    );
  });

  it("treats a FILLED leg with zero size as nothing held", () => {
    expect(decideAtomicity([leg("FILLED", 0), leg("FAILED")], [])).toBe(
      "PREFLIGHT_ALL_OR_NOTHING",
    );
  });
});

describe("the guarantee is never overstated", () => {
  it("never returns the string ATOMIC for any input", () => {
    const statuses = ["FILLED", "KILLED", "FAILED", "NOT_ATTEMPTED"] as const;
    for (const a of statuses)
      for (const b of statuses)
        for (const u of [[], [unwound], [unwindFailed], [unwound, unwound]])
          expect(decideAtomicity([leg(a, 1), leg(b, 1)], u)).not.toMatch(/^ATOMIC$/);
  });

  it("only ever answers one of the four documented guarantees", () => {
    const allowed = [
      "PREFLIGHT_ALL_OR_NOTHING",
      "SEQUENTIAL_VERIFIED",
      "PARTIAL_UNWOUND",
      "PARTIAL_EXPOSED",
    ];
    const statuses = ["FILLED", "KILLED", "FAILED", "NOT_ATTEMPTED"] as const;
    for (const a of statuses)
      for (const b of statuses)
        for (const u of [[], [unwound], [unwindFailed]])
          expect(allowed).toContain(decideAtomicity([leg(a, 1), leg(b, 0)], u));
  });
});
