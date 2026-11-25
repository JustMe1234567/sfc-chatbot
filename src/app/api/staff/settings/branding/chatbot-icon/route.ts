import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { parseBrandingImageDataUrl } from "@/domain/branding";
import {
  getChatbotIconVersion,
  setChatbotIconDataUrl,
} from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The chatbot icon setting (ticket 70): a base64 data URL whose bytes were
 * validated by content (PNG/JPEG/WebP, ≤500 KB) or null to reset to the
 * bundled crest. Admin-only (ticket 102); applied to the launcher,
 * the widget identity surfaces, and the greeting avatar on newly loaded
 * pages via the versioned public asset route.
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
    await setChatbotIconDataUrl(db, null);
    return NextResponse.json({ ok: true, reset: true, version: await getChatbotIconVersion(db) });
  }
  // Type and size are decided by the decoded bytes alone; the browser's
  // declared MIME type is ignored (ticket 70).
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
  await setChatbotIconDataUrl(db, parsed.dataUrl);
  return NextResponse.json({
    ok: true,
    type: parsed.type,
    version: await getChatbotIconVersion(db),
  });
}
