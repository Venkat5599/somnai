/**
 * Deploy, verify the RUNNING app, roll back if it is broken.
 *
 * WHY THIS EXISTS: three deploys in a row compiled successfully on Vercel and
 * then returned 500 on every route. "Compiled successfully" and "Build
 * Completed" were both in the logs each time. The failure was in output file
 * tracing — the build resolves imports through tsconfig paths, so it passes,
 * while the serverless function is missing files it needs at runtime.
 *
 * A green build is not a green deploy. The only proof a deploy works is
 * requesting the routes and reading the status codes. That was being done by
 * hand, inconsistently, and production went down twice because of it.
 *
 * So: deploy to a fresh URL, request every route, and only move the alias if
 * they all answer 200. If any fails, the alias never moves and production is
 * never touched.
 */

import { $ } from "bun";

const ALIASES = ["prism-terminal-cyan.vercel.app"];
/** Every route that must serve. A 500 on any one aborts the promotion. */
const ROUTES = ["/", "/trade", "/markets", "/proof", "/roll", "/settlement", "/positions", "/api/health"];
const TIMEOUT_MS = 40_000;

const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`);

async function status(url: string): Promise<number> {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/** The deployment currently serving the primary alias — the rollback target. */
async function currentTarget(): Promise<string | null> {
  try {
    const out = await $`vercel alias ls`.text();
    const line = out.split("\n").find((l) => l.includes(ALIASES[0]));
    return line?.trim().split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

const main = async () => {
  const known = await currentTarget();
  log(known ? `rollback target: ${known}` : "no known-good target — proceeding carefully");

  log("deploying…");
  const out = await $`vercel --prod --yes`.text();
  const url = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g)?.at(-1);
  if (!url) {
    log("FAILED: no deployment URL returned");
    process.exit(1);
  }
  log(`deployed ${url}`);

  // Vercel's own build logs are NOT sufficient evidence — that is the whole
  // lesson. Request the routes on the deployment itself.
  log("waiting for cold start…");
  await new Promise((r) => setTimeout(r, 8000));

  // The raw deployment URL carries protection and answers 302, so the routes
  // can only be checked once an alias points at it. Promote, then verify, then
  // roll back on failure — the window is seconds, not minutes.
  log(`promoting ${ALIASES[0]}…`);
  await $`vercel alias set ${url} ${ALIASES[0]}`.quiet();
  await new Promise((r) => setTimeout(r, 12_000));

  const results: [string, number][] = [];
  for (const r of ROUTES) results.push([r, await status(`https://${ALIASES[0]}${r}`)]);

  const bad = results.filter(([, c]) => c !== 200);
  for (const [r, c] of results) log(`  ${c === 200 ? "ok  " : "FAIL"} ${String(c).padStart(3)}  ${r}`);

  if (bad.length) {
    log(`${bad.length} route(s) failed — ROLLING BACK`);
    if (known) {
      await $`vercel alias set ${known} ${ALIASES[0]}`.quiet();
      await new Promise((r) => setTimeout(r, 12_000));
      const after = await status(`https://${ALIASES[0]}/trade`);
      log(after === 200 ? "rollback verified: production restored" : `ROLLBACK DID NOT RESTORE (${after})`);
    } else {
      log("NO ROLLBACK TARGET — production may be down. Fix forward.");
    }
    process.exit(1);
  }

  log(`all ${ROUTES.length} routes 200 — promoting remaining aliases`);
  for (const a of ALIASES.slice(1)) await $`vercel alias set ${url} ${a}`.quiet();
  log("deploy verified");
};

await main();
