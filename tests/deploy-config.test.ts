/**
 * Guards against the deploy failure that took production down twice.
 *
 * These assert configuration invariants that a passing BUILD cannot catch.
 * Webpack resolves cross-directory imports through tsconfig paths, so the build
 * is green either way; the serverless function is what ends up missing files.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

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

describe("secrets", () => {
  it("never ships a private key literal in tracked config", () => {
    for (const p of ["frontend/next.config.ts", "package.json", "frontend/package.json"]) {
      expect(read(p)).not.toMatch(/0x[0-9a-fA-F]{64}/);
    }
  });
});
