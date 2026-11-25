import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { parseBrandingImageDataUrl } from "@/domain/branding";
import {
  getDashboardFaviconVersion,
  setDashboardFaviconDataUrl,
} from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The dashboard favicon setting (ticket 70): a validated base64 data URL or
 * null to reset to the bundled crest. The asset is referenced only by the
 * dashboard layouts' metadata — the login page and the authenticated
 * admin pages — and never by the public demo or the widget.
 */
export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as { image?: unknown } | null;
  if (body === null || !("image" in body)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Send the image as a base64 data URL, or null to reset.",
        },
      },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  if (body.image === null) {
    await setDashboardFaviconDataUrl(db, null);
    return NextResponse.json({ ok: true, reset: true, version: await getDashboardFaviconVersion(db) });
  }
  const parsed = parseBrandingImageDataUrl(body.image);
  if (!parsed) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_image",
          message: "Provide a PNG, JPEG, or WebP image up to 500 KB.",
        },
      },
      { status: 400 },
    );
  }
  await setDashboardFaviconDataUrl(db, parsed.dataUrl);
  return NextResponse.json({
    ok: true,
    type: parsed.type,
    version: await getDashboardFaviconVersion(db),
  });
}
