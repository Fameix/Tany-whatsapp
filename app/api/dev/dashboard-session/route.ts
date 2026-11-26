import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardHandoff } from "@/lib/admin/workspace-handoff";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function localRequest(request: NextRequest) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(request.nextUrl.hostname);
}

function secretMatches(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Local-only bootstrap for a developer who already has the server-side secret.
 * The secret is accepted only by this localhost endpoint; it is never placed in
 * a browser URL or cookie. The returned URL contains a single-use random token.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !localRequest(request))
    return NextResponse.json({ message: "Not found." }, { status: 404, headers });
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  const credential = request.headers.get("authorization")?.match(/^Bearer ([^ ]+)$/)?.[1] ?? "";
  if (secret.length < 32 || !secretMatches(credential, secret))
    return NextResponse.json({ message: "Unauthorized." }, { status: 401, headers });
  const handoff = await createDashboardHandoff({ kind: "directory" });
  return NextResponse.json({ path: handoff.path }, { headers });
}
