import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import {
  chatheadFitRequirement,
  isValidChatheadConfig,
  type ChatheadConfig,
} from "@/domain/branding";
import { getChatheadConfig, setChatheadConfig } from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The chathead appearance setting (tickets 70 and 71): background color,
 * icon size, and padding within the domain's bounds, plus — since ticket
 * 71 — the container's width and height (44-96 px each; optional so
 * pre-71 rows stay valid, deriving their size as before), or null to reset
 * to the confirmed defaults. A configuration whose icon and padding do not
 * fit inside both dimensions is refused without touching the stored values,
 * and the error states the minimum size those settings require. The
 * launcher's foreground is derived from the background, never configured,
 * so contrast cannot be broken from this form.
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
            "Provide a hex color and whole pixel sizes within the allowed ranges (icon 32-64, padding 0-12, width and height 44-96).",
        },
      },
      { status: 400 },
    );
  }
  const required = chatheadFitRequirement(candidate as ChatheadConfig);
  if (required !== null) {
    return NextResponse.json(
      {
        error: {
          code: "chathead_does_not_fit",
          message: `The icon and padding need at least ${required} × ${required} px. Increase the chathead width or height, or reduce the icon size or padding.`,
        },
      },
      { status: 400 },
    );
  }
  await setChatheadConfig(db, candidate as ChatheadConfig);
  return NextResponse.json({ ok: true, chathead: await getChatheadConfig(db) });
}
