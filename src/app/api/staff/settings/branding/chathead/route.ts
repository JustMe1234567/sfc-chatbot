import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { DASHBOARD_ROLES } from "@/auth/server";
import { isValidChatheadConfig, type ChatheadConfig } from "@/domain/branding";
import { getChatheadConfig, setChatheadConfig } from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The chathead appearance setting (ticket 70): background color, icon size,
 * and padding within the domain's bounds, or null to reset to the confirmed
 * defaults. The launcher's foreground is derived from the background, never
 * configured, so contrast cannot be broken from this form.
 */
export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: DASHBOARD_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => undefined)) as unknown;
  const { db } = await getChatbotService();
  if (body === null) {
    await setChatheadConfig(db, null);
    return NextResponse.json({ ok: true, reset: true, chathead: await getChatheadConfig(db) });
  }
  if (typeof body !== "object" || body === null || !("chathead" in body)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Send the chathead configuration, or null to reset.",
        },
      },
      { status: 400 },
    );
  }
  const candidate = (body as { chathead?: unknown }).chathead;
  if (!isValidChatheadConfig(candidate)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_chathead",
          message:
            "Provide a hex color and whole pixel sizes within the allowed ranges (icon 32-64, padding 0-12).",
        },
      },
      { status: 400 },
    );
  }
  await setChatheadConfig(db, candidate as ChatheadConfig);
  return NextResponse.json({ ok: true, chathead: await getChatheadConfig(db) });
}
