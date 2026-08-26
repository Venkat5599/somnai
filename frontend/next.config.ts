import type { NextConfig } from "next";
import path from "node:path";

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
