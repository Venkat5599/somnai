"use client";

import { useState } from "react";
import {
  DemoData,
  Button,
  Chip,
  Note,
  PageHead,
  Segmented,
  cx,
} from "@/components/ui";
import { IconBolt, IconCheck, IconCopy, IconInfo } from "@/components/icons";
import { NETWORK, strikeAt } from "@/lib/data";

const ENDPOINTS = [
  {
    group: "Density",
    items: [
      { verb: "GET", path: "/v1/ladder/{asset}/{interval}", note: "repaired survival + density" },
      { verb: "GET", path: "/v1/surface/{asset}", note: "implied vol, strike by expiry" },
      { verb: "WS", path: "/v1/stream/ladder", note: "per-block ladder deltas" },
    ],
  },
  {
    group: "Router",
    items: [
      { verb: "POST", path: "/v1/replicate", note: "intent to leg set, depth aware" },
      { verb: "POST", path: "/v1/quote", note: "priced legs, tick quantised" },
      { verb: "POST", path: "/v1/execute", note: "EIP-7702 batch, session signed" },
    ],
  },
  {
    group: "Lifecycle",
    items: [
      { verb: "GET", path: "/v1/positions", note: "structures and their legs" },
      { verb: "POST", path: "/v1/roll", note: "arm or amend succession" },
      { verb: "POST", path: "/v1/claim", note: "sweep finalised, net payout" },
    ],
  },
] as const;

const VERB_TONE: Record<string, string> = {
  GET: "text-up",
  POST: "text-accent",
  WS: "text-warn",
  DEL: "text-down",
};

const LO = strikeAt("BTC", "4h", -2);
const HI = strikeAt("BTC", "4h", 2);

const REQUEST = `POST ${NETWORK.rest.replace("/v0", "")}/v1/replicate
content-type: application/json

{
  "intent": "RANGE",
  "asset": "BTC",
  "interval_sec": 14400,
  "lower": ${LO},
  "upper": ${HI},
  "size": 100,
  "max_slippage_bps": 100,
  "venue_id": "${NETWORK.venueId.slice(0, 18)}…"
}`;

const RESPONSE = `200 OK

{
  "structure_id": "st_9a8b7c6d",
  "legs": [
    { "side": "UP", "strike": ${LO}, "weight":  100, "price": 0.870 },
    { "side": "UP", "strike": ${HI}, "weight": -100, "price": 0.055 }
  ],
  "net_premium": 81.50,
  "max_payout": 100.00,
  "fill_ratio": 1.0,
  "breakevens": [109904.0, 110991.0],
  "batch": {
    "standard": "eip-7702",
    "calls": 2,
    "expire_timestamp_ns": "1787519257216000000"
  },
  "state": "AWAITING_SIGNATURE"
}`;

export function AgentsView() {
  const [tab, setTab] = useState<"request" | "response">("request");
  const [copied, setCopied] = useState(false);

  const body = tab === "request" ? REQUEST : RESPONSE;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <PageHead
        title="PRISM for agents"
        lede="The density engine and the replication router are the interesting half, so they are exposed directly. An agent can read the risk-neutral density, ask for a leg set, and get back a batch that is ready to sign."
      >
        <Chip tone="neutral">
          Specification
        </Chip>
      </PageHead>

      <DemoData>The request and response payloads are illustrative. The PRISM agent API is not yet serving live quotes.</DemoData>

      <div className="grid gap-px bg-line border border-line lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* reference */}
        <nav aria-label="API reference" className="bg-surface p-4 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <span className="text-label-xs uppercase text-ink-3">Reference</span>
            <span className="num text-[11px] text-ink-4">v1.0.0</span>
          </div>

          {ENDPOINTS.map((g) => (
            <div key={g.group} className="mb-5 last:mb-0">
              <p className="text-label-xs uppercase text-ink-4 mb-2">{g.group}</p>
              <ul className="flex flex-col">
                {g.items.map((e) => (
                  <li
                    key={e.path}
                    className="py-2 border-b border-line-soft last:border-b-0"
                  >
                    <div>
                      <span className="flex items-baseline gap-2 min-w-0">
                        <span
                          className={cx(
                            "num text-[10px] w-[30px] shrink-0",
                            VERB_TONE[e.verb],
                          )}
                        >
                          {e.verb}
                        </span>
                        <span className="num text-[12px] text-ink-2 truncate">
                          {e.path}
                        </span>
                      </span>
                      <span className="block text-[11px] text-ink-4 mt-1 pl-[38px]">
                        {e.note}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* playground */}
        <section className="bg-surface flex flex-col min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 h-14 border-b border-line">
            <Segmented
              label="Payload"
              options={[
                { value: "request" as const, label: "Request" },
                { value: "response" as const, label: "Response" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <Button
              size="sm"
              variant="quiet"
              onClick={copy}
              leading={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </header>

          <div className="p-4 flex-1 min-w-0">
            <pre className="num text-[12px] leading-[19px] text-ink-2 bg-base border border-line p-4 overflow-x-auto">
              <code>{body}</code>
            </pre>
          </div>

          <div className="px-4 pb-4 flex flex-col gap-3">
            <Note icon={<IconInfo size={14} />}>
              Execution is signed by a session key scoped to trading only. It can
              place, cancel and claim; it cannot withdraw. Revoking the key stops
              an agent without touching the funds it was trading.
            </Note>
            <Button
              variant="primary"
              size="lg"
              block
              leading={<IconBolt size={15} />}
              onClick={() => setTab("response")}
              disabled={tab === "response"}
            >
              {tab === "response" ? "Quote returned" : "Generate quote"}
            </Button>
          </div>
        </section>
      </div>

      <div className="grid sm:grid-cols-3 gap-px bg-line border border-line mt-6">
        {[
          {
            t: "Read the density, not the mid",
            b: "The ladder endpoint returns the monotone-repaired survival function and its derivative, so an agent prices against a coherent distribution rather than a set of crossing quotes.",
          },
          {
            t: "Depth aware by construction",
            b: "Every quote is solved against resting size at each rung. A leg set that the book cannot fill comes back scaled, with the fill ratio stated, never silently.",
          },
          {
            t: "One batch, one outcome",
            b: "Legs are submitted as a single EIP-7702 batch. There is no window in which an agent holds half a structure while the second leg is still landing.",
          },
        ].map((c) => (
          <article key={c.t} className="bg-surface p-5 flex flex-col min-h-[168px]">
            <h2 className="text-title-sm text-ink">{c.t}</h2>
            <p className="text-[12px] leading-[19px] text-ink-3 mt-3">{c.b}</p>
          </article>
        ))}
      </div>
    </>
  );
}
