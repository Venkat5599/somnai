import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, Note, PageHead } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { McpInstall } from "@/components/mcp-install";
import { DEFAULT_POLICY } from "@sdk/agent/policy";

export const metadata: Metadata = { title: "Agent — PRISM" };

/**
 * The agent surface, on its own route.
 *
 * It lived inside /agents (the module reference) and was the last thing a
 * visitor found. Driving PRISM from a model is a different job from reading its
 * exported functions, so it gets its own destination in the rail.
 *
 * Everything stated here is enforced in code, not in this page: the numbers are
 * read from `DEFAULT_POLICY`, and the guarantees below are the ones
 * `sdk/agent/policy.ts` and `sdk/agent/credential.ts` are tested against.
 */

const TOOLS: [string, string][] = [
  ["get_policy", "budget, caps, scope and what remains of them"],
  ["list_markets", "live registry rows, with allowedByPolicy on each"],
  ["get_order_book", "resting depth per outcome — books here are often one-sided"],
  ["get_prices", "Somnia's on-chain EMA oracle, the settlement source"],
  ["get_structures", "which structures the venue can express, from live counts"],
  ["get_balances", "collateral and gas, read off chain"],
  ["get_open_orders", "what is still resting, from getOwnOpenOrdersOnchain"],
  ["get_claimable", "settled positions, with a fee-aware payout estimate"],
  ["get_history", "transactions this signer has sent"],
  ["verify_proof", "re-read the recorded lifecycle from chain"],
  ["plan_roll", "can a view carry into the successor, and at what cost"],
  ["plan_batch", "price and gate a structure without signing"],
  ["place_order", "buy one outcome · SPENDS"],
  ["execute_batch", "open a multi-leg structure · SPENDS"],
  ["execute_roll", "carry a view into the next window · SPENDS"],
  ["claim_settlement", "redeem a settled position · collects, costs no budget"],
  ["cancel_orders", "pull resting orders · costs no budget"],
  ["flatten_market", "pull every resting order · the safe exit"],
  ["revoke_session", "stop this session spending, one-way"],
];

export default function AgentPage() {
  return (
    <Page>
      <PageHead
        title="Agent access"
        lede="PRISM runs as an MCP server, so a model can do everything this terminal does — under a spend policy it has no way to raise."
      >
        <Chip tone="accent">{TOOLS.length} tools</Chip>
      </PageHead>

      <Note icon={<IconInfo size={14} />}>
        <span className="font-medium text-ink">Ships dry-run.</span> Every order
        is refused with <span className="num">DRY_RUN</span> until the operator
        sets <span className="num">AGENT_DRY_RUN=false</span>. Arming is an
        explicit act, never a default.
      </Note>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] mt-6">
        <div className="min-w-0">
          <section className="border border-line bg-surface">
            <header className="h-11 px-4 flex items-center border-b border-line">
              <span className="text-label-xs uppercase text-ink-3">The policy</span>
            </header>
            <ul className="grid gap-px bg-line">
              {[
                ["Budget", `${DEFAULT_POLICY.budget} tUSDC per session, charged on FILLED size`],
                ["Per order", `${DEFAULT_POLICY.maxOrderContracts} contract maximum`],
                ["Trade count", `${DEFAULT_POLICY.maxTrades} orders, then the session is spent`],
                ["Cooldown", `${DEFAULT_POLICY.cooldownMs / 1000}s between orders`],
                ["Session TTL", `${DEFAULT_POLICY.ttlMs / 60000} minutes`],
                ["Scope", "an explicit market allowlist — empty permits nothing"],
              ].map(([k, v]) => (
                <li key={k} className="bg-surface px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-label-xs uppercase text-ink-3 w-[6.5rem] shrink-0">{k}</span>
                  <span className="text-[13px] text-ink-2">{v}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-line bg-surface mt-5">
            <header className="h-11 px-4 flex items-center justify-between border-b border-line">
              <span className="text-label-xs uppercase text-ink-3">What the model cannot do</span>
              <span className="num text-[11px] text-ink-4">sdk/agent/</span>
            </header>
            <ul className="p-4 grid gap-2.5 text-[13px] leading-[20px] text-ink-2">
              {[
                "Raise its own budget, size cap, trade count or TTL — the policy is fixed at process start and no tool mutates it.",
                "Reach a market outside the allowlist. An empty allowlist permits nothing, never everything.",
                "Arm a dry-run session. Only the operator's environment can.",
                "Reverse a revoke. revoke_session is one-way.",
                "Gain anything from a copied credential: redeeming a grant mints a higher fence and invalidates the earlier holder, so two clones can never both spend.",
                "Bypass the venue. Orders still pass validateOrder → submitOrder → verifyExecution, so expiry headroom, the integer tick grid and chain verification apply exactly as in the UI.",
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span aria-hidden className="text-ink-4 shrink-0">
                    —
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-line bg-surface mt-5">
            <header className="h-11 px-4 flex items-center border-b border-line">
              <span className="text-label-xs uppercase text-ink-3">Tools</span>
            </header>
            <ul className="grid gap-px bg-line sm:grid-cols-2">
              {TOOLS.map(([name, what]) => (
                <li key={name} className="bg-surface px-4 py-2.5">
                  <p className="num text-[12px] text-ink">{name}</p>
                  <p className="text-[12px] text-ink-3 mt-0.5">{what}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="min-w-0">
          <McpInstall repoPath="/absolute/path/to/prism-terminal" />

          <section className="border border-line bg-surface mt-5">
            <header className="h-11 px-4 flex items-center border-b border-line">
              <span className="text-label-xs uppercase text-ink-3">Hosted, over HTTP</span>
            </header>
            <div className="p-4">
              <p className="text-[13px] leading-[20px] text-ink-2">
                A stdio server cannot be deployed — Claude reaches it by spawning
                a local process, so there is no URL to point at. The HTTP
                transport exists for that:
              </p>
              <pre className="num text-[11px] leading-[18px] text-ink-2 mt-3 p-3 bg-surface-2 border border-line overflow-x-auto">
                {`MCP_HTTP_TOKEN=<32+ chars> \\\n  bun run svc:mcp-http\n\n# POST /mcp   Authorization: Bearer <token>\n# GET  /health`}
              </pre>
              <p className="text-[12px] leading-[19px] text-ink-3 mt-3">
                A bearer token is mandatory — the process refuses to listen
                without one, because a hosted endpoint that can place orders is
                worse unauthenticated than absent. It binds to localhost unless
                told otherwise, and the budget is per-process, not
                per-connection, so exposure does not grow with the number of
                people who find it.
              </p>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
