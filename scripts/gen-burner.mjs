/**
 * Generate a TESTNET burner keypair.
 *
 * The private key is written straight to .env.local (gitignored) and is never
 * printed. Only the public address reaches stdout.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";

const ENV = ".env.local";

if (existsSync(ENV) && /^\s*PRIVATE_KEY\s*=\s*0x[0-9a-fA-F]{64}/m.test(readFileSync(ENV, "utf8"))) {
  console.error("REFUSING: .env.local already contains a PRIVATE_KEY. Not overwriting.");
  process.exit(1);
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

const body = `# PRISM local environment — GITIGNORED, NEVER COMMIT
# Generated ${new Date().toISOString()}
# TESTNET BURNER. Hold no mainnet value on this key, ever.

PRISM_NETWORK=testnet
PRISM_RPC_URL=https://api.infra.testnet.somnia.network
PRISM_WS_RPC_URL=wss://api.infra.testnet.somnia.network/ws
PRISM_INDEXER_URL=https://dev.smk.somnia.host/v1/graphql

# Public address: ${account.address}
PRIVATE_KEY=${pk}

PRISM_DRY_RUN=true
`;

writeFileSync(ENV, body, { mode: 0o600 });
try { chmodSync(ENV, 0o600); } catch {}

console.log("WROTE .env.local (mode 600)");
console.log("PUBLIC ADDRESS: " + account.address);
