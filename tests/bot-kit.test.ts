import { describe, it, expect } from "vitest";
import {
  EC_STRATEGIES,
  STRATEGY_ALIASES,
  STRATEGY_SUPPORT,
  canonicalStrategy,
  parseBotConfig,
} from "../sdk/bot/config";

/**
 * PRISM must accept the kit's own names.
 *
 * The list here was transcribed from the Builder's dropdown and never checked
 * against the kit. It drifted in BOTH directions: it missed `ec-oracle-follow`
 * entirely, and it invented `ec-market-maker`, `ec-passive-bid` and `ec-ladder`
 * while `parseBotConfig` rejected everything else — so a config carrying the
 * kit's documented `STRATEGY=ec-maker` failed to load.
 *
 * The assertions that matter are the ones that FAIL on the old list.
 * `scripts/probe-bot-kit.ts` checks the same thing against the live repo; this
 * file is the offline half that runs in CI without a network.
 */

/** The kit's canonical values, from dreamdex-bot-kit docs/event-contracts.md. */
const KIT_STRATEGIES = [
  "ec-starter",
  "ec-maker",
  "ec-passive",
  "ec-laddering-bot",
  "ec-oracle-follow",
  "ec-settlement",
] as const;

const cfg = (extra: string) =>
  parseBotConfig(`NETWORK=testnet\nDRY_RUN=true\n${extra}`);

const ok = (text: string) => {
  const r = cfg(text);
  if (!r.ok) throw new Error(`expected parse to succeed: ${r.error}`);
  return r.config;
};

describe("every strategy the kit ships is accepted", () => {
  for (const s of KIT_STRATEGIES) {
    it(`accepts STRATEGY=${s}`, () => {
      expect(ok(`STRATEGY=${s}`).strategy).toBe(s);
    });
  }

  it("claims exactly the kit's six, no more and no fewer", () => {
    expect([...EC_STRATEGIES].sort()).toEqual([...KIT_STRATEGIES].sort());
  });

  it("wires a support entry for every one of them", () => {
    for (const s of EC_STRATEGIES) expect(STRATEGY_SUPPORT[s]).toBeDefined();
  });
});

describe("the Builder's UI labels still parse", () => {
  it("maps ec-market-maker to ec-maker", () => {
    expect(ok("STRATEGY=ec-market-maker").strategy).toBe("ec-maker");
  });

  it("maps ec-passive-bid to ec-passive", () => {
    expect(ok("STRATEGY=ec-passive-bid").strategy).toBe("ec-passive");
  });

  it("maps ec-ladder to ec-laddering-bot", () => {
    expect(ok("STRATEGY=ec-ladder").strategy).toBe("ec-laddering-bot");
  });

  it("says which canonical strategy an alias resolved to", () => {
    expect(ok("STRATEGY=ec-market-maker").warnings.join(" ")).toContain("ec-maker");
  });

  it("resolves case and whitespace", () => {
    expect(canonicalStrategy("  EC-Maker  ")).toBe("ec-maker");
  });

  it("every alias points at a real canonical strategy", () => {
    for (const target of Object.values(STRATEGY_ALIASES))
      expect(EC_STRATEGIES).toContain(target);
  });

  it("no alias shadows a canonical name", () => {
    for (const alias of Object.keys(STRATEGY_ALIASES))
      expect(EC_STRATEGIES).not.toContain(alias);
  });
});

describe("what must still be refused", () => {
  it("rejects a spot-track strategy", () => {
    const r = cfg("STRATEGY=momentum");
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown ec- name rather than guessing", () => {
    expect(cfg("STRATEGY=ec-nonsense").ok).toBe(false);
    expect(canonicalStrategy("ec-nonsense")).toBeNull();
  });

  it("names both canonical values and aliases when it refuses", () => {
    const r = cfg("STRATEGY=ec-nonsense");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("ec-maker");
      expect(r.error).toContain("ec-market-maker");
    }
  });

  it("still rejects a missing STRATEGY line", () => {
    expect(cfg("TAKE_MAX_SHARES=5").ok).toBe(false);
  });
});

describe("the kit's common env keys are honoured, not ignored", () => {
  it("reads VENUE_ID, which the kit marks required", () => {
    const c = ok("STRATEGY=ec-starter\nVENUE_ID=0xabc");
    expect(c.venueId).toBe("0xabc");
  });

  it("defaults VENUE_ID to null, meaning unscoped", () => {
    expect(ok("STRATEGY=ec-starter").venueId).toBeNull();
  });

  it("defaults AUTO_CLAIM on, as the kit does", () => {
    expect(ok("STRATEGY=ec-starter").autoClaim).toBe(true);
  });

  it("turns claiming off only on an explicit false", () => {
    expect(ok("STRATEGY=ec-starter\nAUTO_CLAIM=false").autoClaim).toBe(false);
    // A typo must not silently abandon winnings.
    expect(ok("STRATEGY=ec-starter\nAUTO_CLAIM=nope").autoClaim).toBe(true);
  });

  it("reads AUTO_CLAIM_INTERVAL_MS and CLAIM_SCAN with the kit's defaults", () => {
    const d = ok("STRATEGY=ec-starter");
    expect(d.autoClaimIntervalMs).toBe(600_000);
    expect(d.claimScan).toBe(25);
    const c = ok("STRATEGY=ec-starter\nAUTO_CLAIM_INTERVAL_MS=30000\nCLAIM_SCAN=5");
    expect(c.autoClaimIntervalMs).toBe(30_000);
    expect(c.claimScan).toBe(5);
  });

  /**
   * These four keys used to be reported as "unrecognised", which is how the
   * operator learned PRISM was ignoring settings they had deliberately set.
   */
  it("does not report the kit's own keys as unrecognised", () => {
    const c = ok(
      "STRATEGY=ec-starter\nVENUE_ID=0xabc\nAUTO_CLAIM=true\nAUTO_CLAIM_INTERVAL_MS=600000\nCLAIM_SCAN=25",
    );
    const joined = c.warnings.join(" ");
    for (const k of ["VENUE_ID", "AUTO_CLAIM", "AUTO_CLAIM_INTERVAL_MS", "CLAIM_SCAN"])
      expect(joined).not.toContain(k);
  });
});

describe("ec-oracle-follow's edge threshold", () => {
  it("has a non-zero default, so a bot cannot cross on noise", () => {
    expect(ok("STRATEGY=ec-oracle-follow").edge).toBeGreaterThan(0);
  });

  it("is configurable", () => {
    expect(ok("STRATEGY=ec-oracle-follow\nEDGE=0.08").edge).toBeCloseTo(0.08);
  });

  it("falls back rather than accepting a nonsense threshold", () => {
    const c = ok("STRATEGY=ec-oracle-follow\nEDGE=-1");
    expect(c.edge).toBeGreaterThan(0);
  });
});
