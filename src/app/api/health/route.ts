import database from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_HEARTBEAT_MAX_AGE_MS = 20_000;

export async function GET() {
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

    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
