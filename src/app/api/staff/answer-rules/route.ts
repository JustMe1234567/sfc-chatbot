import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import { validateAnswerRuleInput } from "@/domain/answerRules";
import { getChatbotService } from "@/db/service";
import { rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

/** Every rule including drafts, with publisher names for the answers page. */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { store, db } = await getChatbotService();
  const rules = rulesWithPublisherNames(db, await store.listAnswerRules());
  return NextResponse.json({ rules });
}

/**
 * Creates a rule as a draft: publishing is a separate, explicit act, so
 * nothing reaches visitors the moment an editor saves it.
 */
export async function POST(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const body = await request.json().catch(() => null);
  const validation = validateAnswerRuleInput(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const rule: AnswerRule = {
    id: crypto.randomUUID(),
    ...validation.content,
    status: "draft",
    updatedAt: now,
    publishedBy: null,
    reviewedAt: null,
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  return NextResponse.json(rulesWithPublisherNames(db, [rule])[0], { status: 201 });
}
