"use client";

import { useState } from "react";
import {
  Chip,
  PageHead,
  Segmented,
  TableWrap,
  Td,
  Th,
  Tr,
  cx,
} from "@/components/ui";
import { IconArrowOut, IconSearch } from "@/components/icons";
import { ACTIVITY, type ActivityRow } from "@/lib/data";

type Filter = "All" | "Structures" | "Rolls" | "Settlement";

const MATCH: Record<Filter, (r: ActivityRow) => boolean> = {
  All: () => true,
  Structures: (r) => r.action === "Structure Created" || r.action === "Cancel",
  Rolls: (r) => r.action === "Auto Roll",
  Settlement: (r) => r.action === "Settlement" || r.action === "Claim",
};

const STATUS_TONE = {
  Confirmed: "accent",
  Completed: "up",
  Pending: "warn",
  Failed: "down",
} as const;

export function ActivityView() {
  const [filter, setFilter] = useState<Filter>("All");
  const [q, setQ] = useState("");

  const rows = ACTIVITY.filter(MATCH[filter]).filter(
    (r) =>
      q.trim() === "" ||
      `${r.structure} ${r.ref} ${r.market} ${r.tx}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );

  return (
    <>
      <PageHead
        title="Audit log"
        lede="Every router decision, batch and sweep, in the order the chain accepted it. Timestamps are venue time to the millisecond so a fill can always be reconciled against the block that carried it."
      >
        <Chip tone="accent" live>
          Streaming
        </Chip>
      </PageHead>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Segmented
          label="Activity filter"
          options={(["All", "Structures", "Rolls", "Settlement"] as Filter[]).map(
            (f) => ({ value: f, label: f }),
          )}
          value={filter}
          onChange={setFilter}
        />
        <label className="flex items-center border border-line h-9 focus-within:border-accent transition-colors flex-1 min-w-[190px] sm:max-w-[280px]">
          <span className="pl-2.5 text-ink-4 shrink-0">
            <IconSearch size={15} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Structure, reference or hash"
            aria-label="Search activity"
            className="flex-1 min-w-0 h-full bg-transparent px-2.5 text-[13px] text-ink placeholder:text-ink-4 outline-none"
          />
        </label>
      </div>

      <div className="border border-line bg-surface">
        <TableWrap>
          <thead>
            <tr>
              <Th align="right">Time (UTC)</Th>
              <Th>Action</Th>
              <Th>Structure</Th>
              <Th>Market</Th>
              <Th align="right">Amount</Th>
              <Th align="center">Status</Th>
              <Th align="right">Transaction</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.time}>
                <Td align="right" mono tone="muted">
                  {r.time}
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cx(
                        "w-[3px] h-[13px] shrink-0",
                        r.action === "Auto Roll"
                          ? "bg-accent"
                          : r.action === "Claim" || r.action === "Settlement"
                            ? "bg-up"
                            : r.action === "Cancel"
                              ? "bg-down"
                              : "bg-line-strong",
                      )}
                    />
                    <span className="text-ink">{r.action}</span>
                  </span>
                </Td>
                <Td>
                  <span className="flex flex-col leading-tight py-1">
                    <span className="text-ink-2">{r.structure}</span>
                    <span className="num text-[11px] text-ink-4 mt-0.5">{r.ref}</span>
                  </span>
                </Td>
                <Td mono tone="muted">
                  {r.market}
                </Td>
                <Td align="right" mono>
                  {r.amount}
                </Td>
                <Td align="center">
                  <Chip tone={STATUS_TONE[r.status]} live={r.status === "Pending"}>
                    {r.status}
                  </Chip>
                </Td>
                <Td align="right">
                  <a
                    href={`https://shannon-explorer.somnia.network/tx/${r.tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-accent transition-colors"
                  >
                    {r.tx}
                    <IconArrowOut size={12} />
                  </a>
                </Td>
              </Tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="h-24 text-center text-[13px] text-ink-3">
                  Nothing matches this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </TableWrap>

        <div className="flex items-center justify-between gap-4 px-3 h-11 border-t border-line">
          <span className="text-[12px] text-ink-3">
            {rows.length} of {ACTIVITY.length} entries
          </span>
          <span className="num text-[12px] text-ink-4">retained 90 days</span>
        </div>
      </div>
    </>
  );
}
