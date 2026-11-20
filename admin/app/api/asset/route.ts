import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { readAsset } from "@/lib/store";

/** Serves website images to the signed-in admin (including ones not yet live). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return new NextResponse("Unauthorized", { status: 401 });
  const p = req.nextUrl.searchParams.get("path") || "";
  const asset = await readAsset(p, s).catch(() => null);
  if (!asset) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(asset.body as ArrayBuffer), {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
