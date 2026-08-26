import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." and
// the leading slash breaks alias resolution.
const src = fileURLToPath(new URL("./src", import.meta.url));
const sdk = fileURLToPath(new URL("./sdk", import.meta.url));

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": src, "@sdk": sdk } },
});
