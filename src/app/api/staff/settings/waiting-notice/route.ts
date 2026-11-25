import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";
import { getWaitingNotice, setWaitingNotice } from "@/settings";
import { isValidWaitingNotice, MAX_WAITING_NOTICE_LENGTH } from "@/domain/waitingNotice";

/**
 * The handoff waiting notice's published wording (ticket 103), managed
 * where the other visitor-facing content lives: the answer library, by the
 * same roles that publish the welcome message (ticket 102: Admin and
 * Admissions Advisor). The GET returns the effective text (the default
 * while unconfigured) so the form edits what visitors see.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ text: await getWaitingNotice(db) });
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
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (body === null || !isValidWaitingNotice(body.text)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_waiting_notice",
          message: `Provide the notice text: 1 to ${MAX_WAITING_NOTICE_LENGTH} characters after trimming whitespace.`,
        },
      },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  await setWaitingNotice(db, body.text);
  return NextResponse.json({ text: body.text.trim() });
}
