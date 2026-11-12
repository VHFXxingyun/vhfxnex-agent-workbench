import { NextResponse } from "next/server";
import { getUser, publicUser } from "@/lib/auth";
import { getDeepSeekApiKey } from "@/lib/deepseek-key.mjs";
export const runtime = "nodejs";
export async function GET() {
  const user = await getUser();
  return NextResponse.json({
    user: user ? publicUser(user) : null,
    aiConfigured: Boolean(getDeepSeekApiKey()),
  });
}
