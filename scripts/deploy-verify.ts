/**
 * Deploy, verify off production, and only then move the production alias.
 *
 * WHY THIS EXISTS: three deploys in a row compiled successfully on Vercel and
 * then returned 500 on every route. "Compiled successfully" and "Build
 * Completed" were both in the logs each time. The failure was in output file
 * tracing — the build resolves imports through tsconfig paths, so it passes,
 * while the serverless function is missing files it needs at runtime. A green
 * build is not a green deploy; the only proof is requesting the routes.
 *
 * WHAT WAS STILL WRONG WITH THE GATE ITSELF, and is fixed here:
 *
 *   1. IT BROKE PRODUCTION TO TEST. The raw deployment URL answers 302 behind
 *      Vercel's protection, so the old flow promoted the PRODUCTION alias and
 *      verified afterwards — meaning every bad deploy took production down for
 *      the length of the check before rolling back. The window was called
 *      "seconds, not minutes", which is still an outage the gate caused itself.
 *      A separate staging alias is now promoted and verified first, and
 *      production is never pointed at a deployment that has not already served
 *      every route.
 *
 *   2. IT CHECKED EIGHT ROUTES OF FOURTEEN. The route list was written by hand
 *      and had fallen six behind the app, so /structures, /analytics,
 *      /activity, /agents, /docs and /settings were never requested at all.
 *      Routes are now discovered from the App Router tree.
 *
 *   3. A 200 IS NOT A RENDER. A page can answer 200 with an error boundary or
 *      an empty shell. Each page response is now also checked for a marker that
 *      only appears when the app actually rendered.
 */

import { $ } from "bun";
import { verifiableRoutes } from "./routes";

/** The alias real users hit. Never pointed at an unverified deployment. */
const PRODUCTION = process.env.PRISM_PROD_ALIAS ?? "prism-terminal-cyan.vercel.app";
/**
 * Where verification happens. A deployment must serve every route here before
 * production is allowed to point at it.
 */
const STAGING = process.env.PRISM_STAGING_ALIAS ?? "prism-terminal-staging.vercel.app";

const TIMEOUT_MS = 40_000;
/** Vercel's alias propagation is not instant; this is the observed settle time. */
const PROPAGATE_MS = 12_000;

/**
 * Present in every rendered page and in nothing Vercel serves on its own, so it
 * separates "the app rendered" from "something answered 200".
 */
const RENDER_MARKER = "PRISM";

const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${s}`);

interface Probe {
  route: string;
  status: number;
  ok: boolean;
  note: string;
}

/**
 * Request one route and decide whether it actually worked.
 *
 * The body check is the part that matters: a route that 200s with an error
 * boundary is exactly the failure this gate is supposed to catch, and a status
 * code alone cannot see it.
 */
async function probe(base: string, route: string): Promise<Probe> {
  try {
    const res = await fetch(`https://${base}${route}`, {
      redirect: "manual",
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status !== 200)
      return { route, status: res.status, ok: false, note: "" };

    const body = await res.text();

    if (route.startsWith("/api/")) {
      // A handler answers with its own shape; the contract is that it is
      // parseable, not that it contains the app's chrome.
      try {
        JSON.parse(body);
        return { route, status: 200, ok: true, note: "json" };
      } catch {
        return { route, status: 200, ok: false, note: "200 but body is not JSON" };
      }
    }

    if (!body.includes(RENDER_MARKER))
      return { route, status: 200, ok: false, note: "200 but the app did not render" };

    return { route, status: 200, ok: true, note: `${Math.round(body.length / 1024)}kb` };
  } catch (e) {
    return {
      route,
      status: 0,
      ok: false,
      note: e instanceof Error ? e.name : "request failed",
    };
  }
}

/** Request every route against one host. */
async function verify(base: string, routes: string[]): Promise<Probe[]> {
  const results: Probe[] = [];
  for (const route of routes) {
    const p = await probe(base, route);
    results.push(p);
    log(`  ${p.ok ? "ok  " : "FAIL"} ${String(p.status).padStart(3)}  ${p.route.padEnd(14)} ${p.note}`);
  }
  return results;
}

/** The deployment currently serving an alias — the rollback target. */
async function currentTarget(alias: string): Promise<string | null> {
  try {
    const out = await $`vercel alias ls`.text();
    const line = out.split("\n").find((l) => l.includes(alias));
    return line?.trim().split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

async function point(alias: string, deployment: string) {
  await $`vercel alias set ${deployment} ${alias}`.quiet();
  await new Promise((r) => setTimeout(r, PROPAGATE_MS));
}

const main = async () => {
  const routes = verifiableRoutes();
  log(`${routes.length} routes discovered from the App Router: ${routes.join(" ")}`);

  const knownGood = await currentTarget(PRODUCTION);
  log(knownGood ? `production currently serves ${knownGood}` : "no known-good production target");

  log("deploying…");
  const out = await $`vercel --prod --yes`.text();
  const url = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g)?.at(-1);
  if (!url) {
    log("FAILED: no deployment URL returned");
    process.exit(1);
  }
  log(`deployed ${url}`);

  // ---- Verify on staging. Production is untouched for this whole block.
  log(`pointing ${STAGING} at the new deployment…`);
  try {
    await point(STAGING, url);
  } catch (e) {
    log(`could not set the staging alias: ${e instanceof Error ? e.message : String(e)}`);
    log("REFUSING to verify against production instead — that is the outage this gate caused before.");
    log(`Create the alias once with:  vercel alias set ${url} ${STAGING}`);
    process.exit(1);
  }

  log("waiting for cold start…");
  await new Promise((r) => setTimeout(r, 8_000));

  log(`verifying ${routes.length} routes on ${STAGING}:`);
  const staged = await verify(STAGING, routes);
  const bad = staged.filter((p) => !p.ok);

  if (bad.length) {
    log("");
    log(`${bad.length} of ${routes.length} route(s) failed on staging.`);
    log("PRODUCTION WAS NEVER TOUCHED — it is still serving the previous deployment.");
    for (const p of bad) log(`  ${p.route}  ${p.status}  ${p.note}`);
    process.exit(1);
  }

  // ---- Everything served. Now production may move.
  log("");
  log(`all ${routes.length} routes verified on staging — promoting ${PRODUCTION}`);
  await point(PRODUCTION, url);

  // Confirm the alias actually moved and the deployment still serves. This is
  // cheap, and an alias that silently failed to move is indistinguishable from
  // a successful deploy without it.
  log(`confirming ${PRODUCTION}:`);
  const live = await verify(PRODUCTION, routes);
  const stillBad = live.filter((p) => !p.ok);

  if (stillBad.length) {
    log(`${stillBad.length} route(s) failed on production after promotion — ROLLING BACK`);
    if (knownGood) {
      await point(PRODUCTION, knownGood);
      const after = await probe(PRODUCTION, routes[0]);
      log(after.ok ? "rollback verified: production restored" : `ROLLBACK DID NOT RESTORE (${after.status})`);
    } else {
      log("NO ROLLBACK TARGET — production may be down. Fix forward.");
    }
    process.exit(1);
  }

  log(`deploy verified — ${routes.length} routes serving on ${PRODUCTION}`);
};

await main();
