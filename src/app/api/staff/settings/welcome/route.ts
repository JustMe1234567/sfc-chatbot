import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";
import { getWelcomeMessage, setWelcomeMessage } from "@/settings";
import { isValidWelcomeMessage, MAX_WELCOME_LENGTH } from "@/domain/welcome";

/**
 * The fresh-chat greeting's published wording (ticket 41), managed where the
 * other visitor-facing content lives: the answer library, by the same
 * owner/editor roles that publish rules. The GET returns the effective text
 * (the default while unconfigured) so the form edits what visitors see.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ text: await getWelcomeMessage(db) });
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
  if (body === null || !isValidWelcomeMessage(body.text)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_welcome_message",
          message: `Provide the greeting text: 1 to ${MAX_WELCOME_LENGTH} characters after trimming whitespace.`,
        },
      },
      { status: 400 },
    );
  }
  const { db } = await getChatbotService();
  await setWelcomeMessage(db, body.text);
  return NextResponse.json({ text: body.text.trim() });
}
