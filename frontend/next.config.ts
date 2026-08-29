import type { NextConfig } from "next";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

/**
 * Load the REPO-ROOT `.env.local` before Next reads its own.
 *
 * The app lives in `frontend/`, so `next dev` and `next start` look for
 * `frontend/.env.local` and never see the root file where the key actually
 * lives. The visible symptom was /activity reporting "No signer configured.
 * This deployment has no PRIVATE_KEY" on a machine that plainly had one — and
 * every server-signed order failing for the same reason.
 *
 * The wrong fix is a second copy of the file next to the app: two places
 * holding the same private key is how one of them goes stale, and how a secret
 * ends up somewhere nobody is watching. This keeps ONE copy at the root and
 * teaches the app to read it.
 *
 * Existing environment always wins, so a real deployment's injected variables
 * are never overwritten by a stray local file.
 */
function loadRootEnv() {
  const file = path.resolve(process.cwd(), "..", ".env.local");
  if (!existsSync(file)) return;
  // Split on the newline alone and let trim() absorb any trailing CR. A regex
  // literal is the one thing that does not survive being written by a script.
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace("export ", "").trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
loadRootEnv();

/**
 * wagmi ships optional connectors (x402 payment rails, Tempo) whose packages
 * are not installed and are not peer-required. Webpack still tries to resolve
 * the import sites and fails the build.
 *
 * Aliasing them to `false` tells the bundler they resolve to nothing, which is
 * the truth: PRISM connects injected wallets and WalletConnect, and never
 * touches these rails. This is not suppressing a real missing dependency — if
 * one of these were ever used, the failure would surface at the call site.
 */
const UNUSED_CONNECTOR_DEPS = [
  // MetaMask's SDK optionally imports React Native storage. Harmless when the
  // app builds at the repo root, fatal from a subdirectory — module resolution
  // walks up and the optional dep is gone. PRISM is a web app, never uses it.
  "@react-native-async-storage/async-storage",
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
  "accounts",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app lives in frontend/ but imports sdk/, which is its SIBLING. Tracing
  // must start at the REPO ROOT or sdk/ is never bundled into the serverless
  // function — the build passes and every route 500s at runtime, which is
  // exactly what happened twice.
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(UNUSED_CONNECTOR_DEPS.map((m) => [m, false])),
    };
    // pino-pretty is a dev-only logger transport WalletConnect references.
    config.externals = [...(config.externals ?? []), "pino-pretty", "encoding"];
    return config;
  },
};

export default nextConfig;
