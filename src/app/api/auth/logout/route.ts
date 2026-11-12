import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { sameOriginError } from "@/lib/request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  await clearSession();
  return NextResponse.json({ ok: true });
}
