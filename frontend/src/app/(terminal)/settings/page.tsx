import type { Metadata } from "next";
import { Page } from "@/components/shell";
import { Chip, KV, Note, PageHead } from "@/components/ui";
import { IconInfo } from "@/components/icons";
import { COLLATERAL, resolveVenueConfig } from "@sdk/venue/config";
import { cachedMarketSnapshot } from "@sdk/venue/cache";
import { chainCapabilities, batchingLabel } from "@sdk/venue/capabilities";

export const metadata: Metadata = { title: "Settings — PRISM" };

/**
 * Settings, showing the deployment as it actually is.
 *
 * This page previously reported a "Connected" chip that was hard-coded on, a
 * single pinned venue id when the registry is deliberately read unfiltered
 * across several, a 1.00% slippage tolerance that nothing in the codebase
 * applies, "EIP-7702 (planned)" for a standard this chain does not implement,
 * and a note describing a session key that does not exist. A settings screen is
 * the one place a reader goes to find out what is switched on, so inventing
 * values here is worse than leaving the section out.
 *
 * Every row below is now read at request time from the resolved config, the
 * live registry, or a chain probe.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Guard limits live in env, so they are read here rather than restated. */
const envNum = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export default async function SettingsPage() {
  const config = resolveVenueConfig();

  const [snap, caps] = await Promise.all([
    cachedMarketSnapshot().catch(() => null),
    chainCapabilities(config).catch(() => null),
  ]);

  const venueIds = Object.entries(snap?.venues ?? {}).sort((a, b) => b[1] - a[1]);
  const hasSigner = /^0x[0-9a-fA-F]{64}$/.test(process.env.PRIVATE_KEY ?? "");

  const maxOrder = envNum("PRISM_MAX_ORDER_CONTRACTS", 2);
  const reserve = envNum("PRISM_RESERVE", 400);
  const rateLimit = envNum("PRISM_RATE_LIMIT", 5);
  const rateWindowSec = Math.round(envNum("PRISM_RATE_WINDOW_MS", 60_000) / 1000);

  return (
    <Page>
      <PageHead
        title="Settings"
        lede="What this deployment actually has switched on, read at request time from the resolved config, the live registry and a chain capability probe."
      >
        {config.dryRun ? (
          <Chip tone="warn">Dry run — nothing signs</Chip>
        ) : (
          <Chip tone={hasSigner ? "up" : "warn"} live={hasSigner}>
            {hasSigner ? "Armed" : "No signer configured"}
          </Chip>
        )}
      </PageHead>

      <div className="grid gap-px bg-line border border-line lg:grid-cols-2">
        <section className="bg-surface p-5 min-w-0">
          <h2 className="text-title-sm text-ink mb-1">Venue</h2>
          <p className="text-[12px] text-ink-3 mb-3">
            Resolved from the live market rows, not the deployment manifest.
          </p>
          <KV k="Network" v={config.network} />
          <KV k="Chain id" v={String(config.chainId)} />
          <KV k="Collateral" v={`${COLLATERAL.symbol} · ${COLLATERAL.decimals}dp`} />
          <KV k="Markets read" v={String(snap?.all.length ?? 0)} />
          <KV
            k="Venue ids carrying markets"
            v={venueIds.length ? String(venueIds.length) : "unread"}
            tone={config.venueId ? "muted" : undefined}
          />
          <KV
            k="Venue filter"
            v={config.venueId ? `${config.venueId.slice(0, 12)}…` : "none — all venues"}
            tone="muted"
          />
          <KV k="RPC" v={config.rpc.replace("https://", "")} tone="muted" />
          <KV k="Indexer" v={config.indexer.replace("https://", "")} tone="muted" />
        </section>

        <section className="bg-surface p-5 min-w-0">
          <h2 className="text-title-sm text-ink mb-1">Execution</h2>
          <p className="text-[12px] text-ink-3 mb-3">
            Enforced on the server, after the client&apos;s numbers arrive.
          </p>
          <KV
            k="Price / lot grid"
            v="read from the pool"
            tone="muted"
          />
          <KV k="Per-leg order type" v="FILL_OR_KILL" />
          <KV k="Max contracts per order" v={String(maxOrder)} />
          <KV k="Collateral reserve" v={`${reserve} ${COLLATERAL.symbol}`} />
          <KV k="Rate limit" v={`${rateLimit} / ${rateWindowSec}s per caller`} />
          <KV
            k="Multi-leg batching"
            v={caps ? (caps.eip7702 ? "EIP-7702" : "sequential + unwind") : "unread"}
            tone={caps?.eip7702 ? undefined : "muted"}
          />
          <KV k="Auto claim" v="daemon only, not in-app" tone="muted" />
        </section>
      </div>

      {venueIds.length > 1 ? (
        <div className="mt-6 border border-line bg-surface p-5">
          <h2 className="text-title-sm text-ink mb-1">Venue ids seen on this read</h2>
          <p className="text-[12px] text-ink-3 mb-3">
            Active binary markets span more than one venue. Pinning a single id
            hides part of the live book, so the registry is read unfiltered and
            the ids are reported instead.
          </p>
          {venueIds.map(([id, count]) => (
            <KV
              key={id}
              k={`${id.slice(0, 16)}…${id.slice(-6)}`}
              v={`${count} markets`}
              tone="muted"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        <Note icon={<IconInfo size={14} />} tone={caps?.eip7702 ? "accent" : "warn"}>
          {caps ? (
            <>
              <span className="font-medium text-ink">
                Multi-leg batching: {batchingLabel(caps)}
              </span>{" "}
              Probed from chain, not configured. {caps.evidence.at(-1)}
            </>
          ) : (
            <>
              The chain could not be probed for EIP-7702 support, so no batching
              capability is claimed. A capability that cannot be confirmed is
              reported as absent rather than assumed.
            </>
          )}
        </Note>
      </div>
    </Page>
  );
}
