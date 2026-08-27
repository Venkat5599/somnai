/**
 * Every route the app actually serves, discovered from the filesystem.
 *
 * WHY THIS IS NOT A LIST. `deploy-verify.ts` held a hand-written array of eight
 * routes, and the app has fourteen. So /structures, /analytics, /activity,
 * /agents, /docs and /settings were never requested by the deploy gate: any one
 * of them could have been 500ing in production and the gate would have reported
 * "all routes 200" and promoted the alias.
 *
 * That is the same class of mistake the gate was built to catch — trusting a
 * green signal that never looked at the thing it claimed to check. A list a
 * human maintains falls behind the day someone adds a page, and nobody notices,
 * because the failure is silent by construction.
 *
 * So the routes are read from the App Router tree instead. Adding a page adds it
 * to the deploy gate automatically; there is nothing to remember.
 *
 * Pure and fs-only, so the tests can call it without a build or a network.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Where the App Router lives, relative to the repo root. */
export const APP_DIR = join("frontend", "src", "app");

/** A path segment wrapped in parentheses is a route GROUP — it has no URL. */
const isRouteGroup = (segment: string) => segment.startsWith("(") && segment.endsWith(")");

/** Private folders and parallel/intercepting routes are not addressable pages. */
const isNonRouting = (segment: string) =>
  segment.startsWith("_") || segment.startsWith("@") || segment.startsWith(".");

/**
 * A dynamic segment cannot be requested without a real parameter, so the deploy
 * gate has nothing safe to fetch. There are none today; this keeps the gate
 * honest if one is added rather than letting it request a literal "[id]".
 */
const isDynamic = (segment: string) => segment.includes("[");

export interface DiscoveredRoute {
  /** The URL path, e.g. "/roll" or "/api/health". */
  path: string;
  /** "page" renders HTML; "route" is a handler and returns whatever it returns. */
  kind: "page" | "route";
  /** Set when the route exists but cannot be fetched blind. */
  skipped?: "dynamic";
}

/**
 * Walk the App Router tree.
 *
 * Recursive over directories, collecting a route wherever a `page.tsx` or a
 * `route.ts` sits. Segment kinds follow Next's own rules rather than a guess:
 * groups collapse, private folders are skipped, dynamic segments are recorded
 * but flagged unfetchable.
 */
export function discoverRoutes(appDir: string = APP_DIR): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];

  const walk = (dir: string, urlSegments: string[], dynamic: boolean) => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const file = (name: string) => entries.some((e) => e.isFile() && e.name === name);
    const path = "/" + urlSegments.join("/");

    if (file("page.tsx") || file("page.ts"))
      found.push({ path: path === "/" ? "/" : path, kind: "page", ...(dynamic ? { skipped: "dynamic" as const } : {}) });
    if (file("route.ts") || file("route.tsx"))
      found.push({ path, kind: "route", ...(dynamic ? { skipped: "dynamic" as const } : {}) });

    for (const e of entries) {
      if (!e.isDirectory() || isNonRouting(e.name)) continue;
      // A group contributes a directory level but no URL level.
      walk(
        join(dir, e.name),
        isRouteGroup(e.name) ? urlSegments : [...urlSegments, e.name],
        dynamic || isDynamic(e.name),
      );
    }
  };

  walk(appDir, [], false);

  // Deduplicate (a group and its parent can both resolve to "/") and sort so
  // the deploy log reads the same way every run.
  const seen = new Set<string>();
  return found
    .filter((r) => {
      const key = `${r.kind}${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The routes a deploy gate can actually request. Dynamic ones are excluded. */
export function verifiableRoutes(appDir: string = APP_DIR): string[] {
  return discoverRoutes(appDir)
    .filter((r) => !r.skipped)
    .map((r) => r.path);
}
