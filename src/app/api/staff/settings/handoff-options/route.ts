import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import {
  getHandoffOptions,
  isValidHandoffOptionList,
  setHandoffOptions,
} from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The configured click-to-handoff options (ticket 67, content-editor
 * territory like answer rules). The widget reads them on every open, so a
 * save changes what visitors see on their next widget open with no
 * redeploy. Deliberately separate from the typed Handoff phrases: only a
 * click carries the handoff action.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ options: await getHandoffOptions(db) });
}

export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as { options?: unknown } | null;
  if (!body || !isValidHandoffOptionList(body.options)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_options",
          message: "Provide up to 50 options, each at most 200 characters.",
        },
      },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  await setHandoffOptions(db, body.options);
  return NextResponse.json({ options: body.options });
}
