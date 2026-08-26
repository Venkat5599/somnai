import "server-only";

/**
 * Observability.
 *
 * At 50k users you cannot debug by reading the screen. This is the minimum that
 * makes a production incident diagnosable: structured events, counters, and
 * latency percentiles that a health endpoint can expose.
 *
 * Deliberately dependency-free and in-process. A hosted APM (Sentry, Datadog)
 * is the right answer at scale and this is shaped to be replaced by one — every
 * event goes through `emit()`, so swapping the sink is a single function.
 *
 * NEVER LOGGED: private keys, signed payloads, raw transaction data, or any
 * env value. Addresses and tx hashes ARE logged — they are public chain data
 * and are the only way to correlate a report with what actually happened.
 */

export type Level = "debug" | "info" | "warn" | "error";

export interface Event {
  level: Level;
  op: string;
  ms?: number;
  ok?: boolean;
  /** Public, correlatable detail only. */
  meta?: Record<string, string | number | boolean | null>;
}

/* ------------------------------------------------------------------ */
/* Counters + latency                                                  */
/* ------------------------------------------------------------------ */

const counters = new Map<string, number>();
const latencies = new Map<string, number[]>();
const startedAt = Date.now();

/** Bounded ring per op, so a long-lived process cannot leak memory. */
const MAX_SAMPLES = 200;

function record(op: string, ms: number, ok: boolean) {
  counters.set(`${op}.${ok ? "ok" : "fail"}`, (counters.get(`${op}.${ok ? "ok" : "fail"}`) ?? 0) + 1);
  const arr = latencies.get(op) ?? [];
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.shift();
  latencies.set(op, arr);
}

const pct = (sorted: number[], p: number): number =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

export interface Snapshot {
  uptimeSec: number;
  counters: Record<string, number>;
  latency: Record<string, { n: number; p50: number; p95: number; max: number }>;
}

export function snapshot(): Snapshot {
  const latency: Snapshot["latency"] = {};
  for (const [op, arr] of latencies) {
    const s = [...arr].sort((a, b) => a - b);
    latency[op] = { n: s.length, p50: pct(s, 50), p95: pct(s, 95), max: s.at(-1) ?? 0 };
  }
  return {
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    counters: Object.fromEntries(counters),
    latency,
  };
}

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

/** Single sink. Point this at an APM and everything follows. */
export function emit(e: Event): void {
  const line = JSON.stringify({ t: new Date().toISOString(), ...e });
  if (e.level === "error") console.error(line);
  else if (e.level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Time an operation, record it, and re-throw.
 *
 * Re-throwing matters: this measures, it does not swallow. A wrapper that ate
 * errors would make the metrics look healthier than the system.
 */
export async function tracked<T>(
  op: string,
  fn: () => Promise<T>,
  meta?: Event["meta"],
): Promise<T> {
  const s = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - s;
    record(op, ms, true);
    emit({ level: "info", op, ms, ok: true, meta });
    return r;
  } catch (err) {
    const ms = Date.now() - s;
    record(op, ms, false);
    emit({
      level: "error",
      op,
      ms,
      ok: false,
      meta: { ...meta, error: err instanceof Error ? err.message.slice(0, 200) : String(err) },
    });
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Retry                                                               */
/* ------------------------------------------------------------------ */

/**
 * Retry with exponential backoff and jitter.
 *
 * The testnet indexer times out regularly and it is not ours to fix, so the
 * client has to absorb it. Jitter is not decoration: without it every instance
 * retries on the same schedule and the retry storm becomes the outage.
 *
 * Only transient failures are retried. A malformed request would fail
 * identically every time, so retrying it just multiplies load.
 */
export async function withRetry<T>(
  op: string,
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 250,
): Promise<T> {
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /timed out|timeout|ECONNRESET|ETIMEDOUT|fetch failed|socket|503|502|429|empty response/i.test(msg);

      if (!transient || i === attempts - 1) {
        counters.set(`${op}.retry.exhausted`, (counters.get(`${op}.retry.exhausted`) ?? 0) + 1);
        throw err;
      }

      counters.set(`${op}.retry`, (counters.get(`${op}.retry`) ?? 0) + 1);
      const delay = baseMs * 2 ** i + Math.random() * baseMs;
      emit({
        level: "warn",
        op: `${op}.retry`,
        meta: { attempt: i + 1, delayMs: Math.round(delay), reason: msg.slice(0, 120) },
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}
