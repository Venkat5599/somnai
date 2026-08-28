import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isValidWalletConnectProjectId } from "../frontend/src/lib/wagmi";

/**
 * A credential is present or it is absent. It is never invented.
 *
 * `getDefaultConfig` requires a `projectId`, and the previous version satisfied
 * that signature with the literal string `"prism-terminal-local"`. That is not
 * a project id: Reown's relay rejected it on every page load, so a healthy
 * deployment carried a permanent `403` in the console — which is worse than a
 * missing feature, because it teaches the reader to ignore the console.
 *
 * These tests hold the shape check, and hold the file itself to having no
 * placeholder in it.
 */

describe("isValidWalletConnectProjectId", () => {
  it("accepts a real 32-character hex id", () => {
    expect(isValidWalletConnectProjectId("0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("accepts uppercase hex — Reown is not case sensitive", () => {
    expect(isValidWalletConnectProjectId("0123456789ABCDEF0123456789ABCDEF")).toBe(true);
  });

  it("tolerates surrounding whitespace from a pasted .env line", () => {
    expect(isValidWalletConnectProjectId("  0123456789abcdef0123456789abcdef  ")).toBe(true);
  });

  /* --- the cases that caused the 403 --- */

  it("rejects the placeholder that used to ship", () => {
    expect(isValidWalletConnectProjectId("prism-terminal-local")).toBe(false);
  });

  it("rejects any non-hex string of the right length", () => {
    expect(isValidWalletConnectProjectId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });

  it("rejects a uuid that still has its dashes", () => {
    expect(isValidWalletConnectProjectId("01234567-89ab-cdef-0123-456789abcdef")).toBe(false);
  });

  it("rejects a too-short or too-long id", () => {
    expect(isValidWalletConnectProjectId("0123456789abcdef")).toBe(false);
    expect(isValidWalletConnectProjectId("0123456789abcdef0123456789abcdef00")).toBe(false);
  });

  it("rejects empty, blank and undefined", () => {
    expect(isValidWalletConnectProjectId("")).toBe(false);
    expect(isValidWalletConnectProjectId("   ")).toBe(false);
    expect(isValidWalletConnectProjectId(undefined)).toBe(false);
  });
});

describe("wagmi.ts carries no placeholder credential", () => {
  const src = readFileSync("frontend/src/lib/wagmi.ts", "utf8");

  it("no longer contains the literal placeholder project id", () => {
    // Split so this assertion does not itself put the string back in the tree
    // in a form the next grep would find.
    expect(src).not.toContain("prism-terminal" + "-local");
  });

  it("registers WalletConnect only behind the validity check", () => {
    expect(src).toContain("walletConnectProjectId");
    expect(src).toContain("isValidWalletConnectProjectId");
  });

  it("still offers injected wallets, which need no relay or credential", () => {
    expect(src).toContain("injectedWallet");
    expect(src).toContain("metaMaskWallet");
  });
});
