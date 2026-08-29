"use client";

/**
 * The terminal chrome.
 *
 * The nav is treated, not defaulted: a fixed instrument rail with a machined
 * left edge, an active state carried by an inset accent cut and a tonal fill
 * rather than a dot or a pill. On narrow screens the rail collapses to a sheet
 * that is opened by an explicit control, never hidden behind a hover.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PrismMark, PrismWordmark } from "./logo";
import { Connect } from "./connect";
import { WalletBalance } from "./wallet-balance";
import { cx } from "./ui";
import { NETWORK } from "@sdk/venue/config";
import {
  IconActivity,
  IconAgents,
  IconAnalytics,
  IconBell,
  IconCheck,
  IconCross,
  IconDocs,
  IconMarkets,
  IconMenu,
  IconPositions,
  IconRoll,
  IconSettings,
  IconSettlement,
  IconStructures,
  IconTrade,
} from "./icons";

const NAV = [
  { href: "/trade", label: "Trade", Icon: IconTrade },
  { href: "/markets", label: "Markets", Icon: IconMarkets },
  { href: "/structures", label: "Structures", Icon: IconStructures },
  { href: "/analytics", label: "Analytics", Icon: IconAnalytics },
  { href: "/positions", label: "Positions", Icon: IconPositions },
  { href: "/roll", label: "Roll Engine", Icon: IconRoll },
  { href: "/settlement", label: "Settlement", Icon: IconSettlement },
  { href: "/proof", label: "Proof", Icon: IconCheck },
  { href: "/activity", label: "Activity", Icon: IconActivity },
  // Agent is its OWN destination, not a subsection of Integration. Driving
  // PRISM from a model is a different job from reading its module reference,
  // and burying it cost it every visitor who did not already know it existed.
  { href: "/agent", label: "Agent", Icon: IconAgents },
  { href: "/agents", label: "Integration", Icon: IconAgents },
  { href: "/docs", label: "Documentation", Icon: IconDocs },
] as const;

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh flex flex-col bg-base">
      <TopBar onMenu={() => setOpen(true)} />

      <div className="flex flex-1 min-h-0">
        <nav
          aria-label="Terminal sections"
          className="hidden lg:flex w-[214px] shrink-0 flex-col border-r border-line bg-surface"
        >
          <RailContent pathname={pathname} />
        </nav>

        {open ? (
          <>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
              className="lg:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]"
            />
            <nav
              aria-label="Terminal sections"
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-[240px] flex flex-col border-r border-line-strong bg-surface"
            >
              <div className="flex items-center justify-between h-14 px-4 border-b border-line shrink-0">
                <span className="inline-flex items-center gap-2">
                  <PrismMark size={22} />
                  <PrismWordmark size={17} className="text-accent" />
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className="text-ink-3 hover:text-ink transition-colors p-1"
                >
                  <IconCross size={16} />
                </button>
              </div>
              <RailContent pathname={pathname} />
            </nav>
          </>
        ) : null}

        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}

function RailContent({ pathname }: { pathname: string }) {
  return (
    <>
      <div className="px-4 py-4 border-b border-line shrink-0">
        <p className="text-[13px] text-ink font-medium leading-tight">
          PRISM Terminal
        </p>
        <p className="text-label-xs uppercase text-ink-4 mt-1.5">
          Structured event contracts
        </p>
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto py-2">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex items-center gap-3 h-10 pl-4 pr-3",
                  "text-[13px] transition-colors duration-150",
                  active
                    ? "bg-[#2b2115] text-accent font-medium"
                    : "text-ink-3 hover:text-ink hover:bg-surface-2",
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute left-0 inset-y-0 w-[2px] bg-accent"
                  />
                ) : null}
                <Icon size={17} className="shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line shrink-0">
        <Link
          href="/settings"
          className="flex items-center gap-3 h-11 px-4 text-[13px] text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
        >
          <IconSettings size={17} className="shrink-0" />
          <span>Settings</span>
        </Link>
      </div>
    </>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="h-14 shrink-0 border-b border-line bg-surface/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="h-full flex items-center gap-3 px-4">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="lg:hidden text-ink-3 hover:text-ink transition-colors p-1 -ml-1"
        >
          <IconMenu size={18} />
        </button>

        <Link href="/" className="inline-flex items-center gap-2.5 shrink-0">
          <PrismMark size={24} />
          <PrismWordmark size={18} className="text-accent" />
        </Link>

        <span className="hidden sm:inline ml-3 text-label-xs uppercase text-ink-4 truncate">
          Structured derivatives on Event Contracts
        </span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-label="Notifications, 2 unread"
            className="relative text-ink-3 hover:text-ink transition-colors p-1.5"
          >
            <IconBell size={17} />
            <span
              aria-hidden
              className="absolute top-1 right-1 w-[5px] h-[5px] bg-accent"
            />
          </button>

          <WalletBalance compact />
          <Connect />

          <div className="flex items-stretch border border-line h-8">
            <span className="hidden sm:flex items-center px-2.5 text-label-xs uppercase text-ink-3 border-r border-line">
              <span className="pip-live inline-block w-[5px] h-[5px] bg-up mr-2" />
              {NETWORK.name}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Scrollable page body with the standard page margin. */
export function Page({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex-1 min-h-0 overflow-y-auto", className)}>
      <div className="px-4 sm:px-6 py-6 max-w-[1560px] mx-auto w-full">{children}</div>
    </div>
  );
}
