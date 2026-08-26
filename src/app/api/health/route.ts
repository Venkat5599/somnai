import { NextResponse } from "next/server";
import { snapshot } from "@sdk/observability";
import { VENUE_CONFIG } from "@sdk/venue/config";

export const dynamic = "force-dynamic";

/**
 * Liveness + in-process metrics for the web tier.
 *
 * Reports its OWN health only. Whether the executor and market-data services
 * are up is their /health to answer — a web node claiming a peer is healthy
 * would be guessing, and a green light nobody verified is worse than none.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "web",
    network: VENUE_CONFIG.network,
    ...snapshot(),
  });
}
