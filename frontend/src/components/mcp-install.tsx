"use client";

/**
 * The MCP connection block, copyable.
 *
 * A config a reader has to retype from a screenshot is a config they will get
 * wrong, so this is one click. The JSON is generated from the same defaults the
 * server reads, which means it cannot drift from what the process actually
 * enforces the way a hand-written snippet in a doc would.
 *
 * IT SHIPS DRY-RUN. `AGENT_DRY_RUN` is "true" here and only an explicit "false"
 * arms it — the same fail-safe as PRISM_DRY_RUN. Somebody pasting this into
 * Claude gets a session that can read the venue and is refused every order,
 * which is the correct default for a config you hand to strangers.
 */

import { useState } from "react";
import { cx } from "./ui";

/**
 * The config, as one string. Shared by the full panel and the hero button so
 * the two can never drift — a landing page that copies a different config from
 * the one the docs show is worse than having no button.
 */
export function mcpConfigJson(repoPath = "/absolute/path/to/prism-terminal") {
  return JSON.stringify(
    {
      mcpServers: {
        prism: {
          command: "bun",
          args: ["--conditions", "react-server", "backend/mcp/index.ts"],
          cwd: repoPath,
          env: {
            PRISM_NETWORK: "testnet",
            PRISM_DRY_RUN: "true",
            AGENT_DRY_RUN: "true",
            AGENT_BUDGET: "5",
            AGENT_MAX_ORDER: "1",
            AGENT_MAX_TRADES: "10",
            AGENT_COOLDOWN_MS: "3000",
            AGENT_TTL_MS: "3600000",
            AGENT_MARKETS: "",
          },
        },
      },
    },
    null,
    2,
  );
}

/**
 * One-click copy for the hero. Same JSON as the docs panel, by construction.
 */
export function McpCopyButton({ className }: { className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(mcpConfigJson());
      setState("copied");
    } catch {
      // Clipboard access is permission-gated and can simply refuse. Never show
      // a success state for something that did not happen.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button type="button" onClick={onClick} className={className}>
      {state === "copied"
        ? "Copied — paste into Claude"
        : state === "failed"
          ? "Clipboard blocked"
          : "Copy MCP config"}
    </button>
  );
}

export function McpInstall({ repoPath }: { repoPath: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const config = mcpConfigJson(repoPath);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard is permission-gated and can simply refuse. Say so rather than
      // showing a success state for something that did not happen.
      setCopied("failed");
      setTimeout(() => setCopied(null), 1800);
    }
  };

  const Block = ({ label, text }: { label: string; text: string }) => (
    <div className="border border-line bg-surface-2">
      <header className="flex items-center justify-between h-9 px-3 border-b border-line">
        <span className="text-label-xs uppercase text-ink-3">{label}</span>
        <button
          type="button"
          onClick={() => copy(label, text)}
          className={cx(
            "text-label-xs uppercase px-2 h-6 border transition-colors",
            copied === label
              ? "border-up text-up"
              : copied === "failed"
                ? "border-down text-down"
                : "border-line text-ink-3 hover:text-accent hover:border-accent",
          )}
        >
          {copied === label ? "Copied" : copied === "failed" ? "Blocked" : "Copy"}
        </button>
      </header>
      <pre className="num text-[11px] leading-[18px] text-ink-2 p-3 overflow-x-auto">
        {text}
      </pre>
    </div>
  );

  return (
    <div className="grid gap-3">
      <Block label="claude_desktop_config.json" text={config} />
      <Block
        label="Run it directly"
        text="bun run svc:mcp"
      />
      <p className="text-[12px] leading-[19px] text-ink-3">
        Ships dry-run. The agent can read the whole venue and every order is
        refused with <span className="num text-ink-2">DRY_RUN</span> until you
        set <span className="num text-ink-2">AGENT_DRY_RUN=false</span> — and
        even then it is bounded by the budget, per-order cap, trade count,
        cooldown and market allowlist above. An empty{" "}
        <span className="num text-ink-2">AGENT_MARKETS</span> permits nothing,
        never everything.
      </p>
    </div>
  );
}
