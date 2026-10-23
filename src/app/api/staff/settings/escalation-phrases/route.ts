import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import {
  getEscalationPhrases,
  isValidEscalationPhraseList,
  setEscalationPhrases,
} from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The configured handoff phrases (content-editor territory, like answer
 * rules). The visitor matcher reads them from settings on every question, so
 * a save changes routing on the next question with no redeploy.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ phrases: getEscalationPhrases(db) });
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
  const body = (await request.json().catch(() => null)) as { phrases?: unknown } | null;
  if (!body || !isValidEscalationPhraseList(body.phrases)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_phrases",
          message: "Provide up to 50 phrases, each at most 200 characters.",
        },
      },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  setEscalationPhrases(db, body.phrases);
  return NextResponse.json({ phrases: body.phrases });
}
