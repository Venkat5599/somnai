/**
 * Venue grid arithmetic.
 *
 * Deliberately NOT server-only: this is pure integer maths with no SDK, no
 * network and no key, and it is the part that most needs testing — the
 * 18-decimal rounding bug is invisible on a 6-decimal testnet, so the only
 * proof the fix works is a unit test that reproduces the failure first.
 */

/** Venue grid, in raw collateral units. Mainnet is 18dp; testnet 6dp. */
export function gridFor(network: string) {
  return network === "mainnet"
    ? { tick: 1_000_000_000_000_000n, lot: 1_000_000_000_000_000n }
    : { tick: 1_000n, lot: 1n };
}

/**
 * Human value to an exact multiple of `step`.
 *
 * The conversion happens in STEP units, not raw units: `human * stepsPerOne` is
 * a small number where rounding is exact, so the float's epsilon never reaches
 * the wire. Sizes floor (never send more than asked); prices round.
 */
export function toSteps(
  human: number,
  one: bigint,
  step: bigint,
  mode: "round" | "floor",
): bigint {
  const stepsPerOne = Number(one / step);
  const n = human * stepsPerOne;
  const steps = mode === "round" ? Math.round(n) : Math.floor(n + 1e-9);
  return BigInt(Math.max(0, steps)) * step;
}
