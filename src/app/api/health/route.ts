import database from "@/lib/db";
import { resolveDatabasePath } from "@/lib/database-path.mjs";
import { matchesSmokeDatabaseProof } from "@/lib/smoke-database-proof.mjs";
import { isSessionSecretValid } from "@/lib/session-secret.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_HEARTBEAT_MAX_AGE_MS = 20_000;

export async function GET(request: Request) {
  try {
    database.prepare("SELECT 1").get();
    const worker = database
      .prepare("SELECT state, updated_at FROM service_heartbeats WHERE service = ?")
      .get("workbench-worker") as { state: string; updated_at: number } | undefined;

    if (
      !worker ||
      worker.state !== "running" ||
      Date.now() - worker.updated_at > WORKER_HEARTBEAT_MAX_AGE_MS
    ) {
      return Response.json(
        { status: "unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const smokeDatabaseProof = request.headers.get("x-vhfxnex-smoke-db-proof");
    if (smokeDatabaseProof) {
      const sessionSecret = process.env.SESSION_SECRET || "";
      const matchesConfiguredDatabase =
        matchesSmokeDatabaseProof(smokeDatabaseProof, resolveDatabasePath(), sessionSecret) &&
        isSessionSecretValid(sessionSecret);
      if (!matchesConfiguredDatabase) {
        return Response.json(
          { status: "unavailable", reason: "database_mismatch" },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { status: "ok", smokeDatabaseMatched: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
