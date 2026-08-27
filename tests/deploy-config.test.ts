/**
 * Guards against the deploy failure that took production down twice.
 *
 * These assert configuration invariants that a passing BUILD cannot catch.
 * Webpack resolves cross-directory imports through tsconfig paths, so the build
 * is green either way; the serverless function is what ends up missing files.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { discoverRoutes, verifiableRoutes } from "../scripts/routes";

const read = (p: string) => readFileSync(p, "utf8");

describe("output file tracing", () => {
  it("traces from the repo root, not the frontend directory", () => {
    // frontend/ imports sdk/, its SIBLING. If tracing starts at frontend/,
    // sdk/ is outside it and never enters the lambda: the build passes and
    // every route 500s at runtime. This exact line cost two outages.
    const cfg = read("frontend/next.config.ts");
    expect(cfg).toContain("outputFileTracingRoot");
    expect(cfg).toMatch(/outputFileTracingRoot:\s*path\.join\(process\.cwd\(\),\s*["']\.\.["']\)/);
  });
});

describe("workspace layout", () => {
  it("keeps the app and its shared code where the config expects them", () => {
    for (const p of ["frontend/src/app", "sdk/venue", "sdk/dreamdex", "backend"]) {
      expect(existsSync(p), `${p} is missing — deploy config assumes it exists`).toBe(true);
    }
  });

  it("gives frontend/ its own manifest, since Vercel builds from there", () => {
    expect(existsSync("frontend/package.json")).toBe(true);
    expect(existsSync("frontend/tsconfig.json")).toBe(true);
  });

  it("aliases the optional connector deps that break a subdirectory build", () => {
    // MetaMask's RN storage import resolves at the repo root and fails from a
    // subdirectory. Removing this alias breaks the build, not the runtime —
    // different failure, same restructure.
    const cfg = read("frontend/next.config.ts");
    expect(cfg).toContain("@react-native-async-storage/async-storage");
  });
});

describe("the deploy gate checks every route that exists", () => {
  /**
   * The gate used to hold a hand-written list of eight routes against an app
   * with fourteen, so six pages were never requested and could have been 500ing
   * in production under a "all routes 200" log line. These assert the list can
   * never fall behind again.
   */

  it("finds the terminal pages and the health handler", () => {
    const paths = verifiableRoutes();
    for (const expected of [
      "/",
      "/trade",
      "/markets",
      "/structures",
      "/analytics",
      "/positions",
      "/roll",
      "/settlement",
      "/proof",
      "/activity",
      "/agents",
      "/docs",
      "/settings",
      "/api/health",
    ]) {
      expect(paths, `${expected} is not in the verified route set`).toContain(expected);
    }
  });

  it("collapses route groups — (terminal) is a directory, not a URL segment", () => {
    for (const p of verifiableRoutes()) expect(p).not.toContain("(");
    expect(verifiableRoutes()).toContain("/trade");
  });

  it("covers one route per page file, with nothing invented", () => {
    // Every discovered page must correspond to a file on disk. A route the gate
    // requests but that does not exist would fail the deploy for no reason.
    for (const r of discoverRoutes()) {
      const dir = r.path === "/" ? "" : r.path;
      const base = `frontend/src/app${dir}`;
      const grouped = `frontend/src/app/(terminal)${dir}`;
      const file = r.kind === "page" ? "page.tsx" : "route.ts";
      expect(
        existsSync(`${base}/${file}`) || existsSync(`${grouped}/${file}`),
        `${r.path} was discovered but no ${file} backs it`,
      ).toBe(true);
    }
  });

  it("never asks the gate to fetch a dynamic segment blind", () => {
    for (const p of verifiableRoutes()) expect(p).not.toContain("[");
  });

  it("verifies off a staging alias, so a bad deploy cannot take production down", () => {
    // The previous gate promoted production and checked afterwards, so every
    // failed deploy caused the outage it was written to prevent.
    const gate = read("scripts/deploy-verify.ts");
    expect(gate).toContain("PRISM_STAGING_ALIAS");
    // Route list must come from discovery, never from an array in this file.
    expect(gate).toContain("verifiableRoutes");
    expect(gate).not.toMatch(/const ROUTES\s*=\s*\[/);
  });

  it("checks the body, because a 200 is not proof the app rendered", () => {
    expect(read("scripts/deploy-verify.ts")).toContain("RENDER_MARKER");
  });
});

describe("secrets", () => {
  it("never ships a private key literal in tracked config", () => {
    for (const p of ["frontend/next.config.ts", "package.json", "frontend/package.json"]) {
      expect(read(p)).not.toMatch(/0x[0-9a-fA-F]{64}/);
    }
  });
});
