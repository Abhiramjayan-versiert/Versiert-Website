import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { startSession } from "@/lib/session";

/** Local development only: disabled whenever NODE_ENV=production. */
export async function POST(req: NextRequest) {
  if (!env.devLogin) return new NextResponse("Not found", { status: 404 });
  await startSession({ login: "local-dev", name: "Local developer", dev: true });
  return NextResponse.redirect(new URL("/", req.url), 303);
}
