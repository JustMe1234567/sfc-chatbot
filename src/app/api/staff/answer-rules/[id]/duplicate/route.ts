import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import { MAX_TOPIC_LENGTH } from "@/domain/answerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Duplicate (ticket 58): creates a separate Draft prefilled with the
 * original's content — topic, response, phrases, keyword conditions, and
 * college link — leaving the original untouched. The copy is never live:
 * like every new answer it stays a draft until it is explicitly published,
 * and it starts with clean attribution and no Trash stamp.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }
  const { rule: existing, staff } = loaded;

  // " (copy)" marks the duplicate's topic without crowding the 80-character
  // limit: the suffix always fits because the base is trimmed to match.
  const suffix = " (copy)";
  const topic = existing.topic.slice(0, MAX_TOPIC_LENGTH - suffix.length) + suffix;
  const rule: AnswerRule = {
    id: crypto.randomUUID(),
    topic,
    response: existing.response,
    ...(existing.link ? { link: existing.link } : {}),
    phrases: [...existing.phrases],
    ...(existing.keywords ? { keywords: existing.keywords.map((condition) => [...condition]) } : {}),
    status: "draft",
    updatedAt: new Date().toISOString(),
    publishedBy: null,
    reviewedAt: null,
    trashedAt: null,
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  await audit(store, staff.userId, "rule_duplicated", { ruleId: rule.id });
  return NextResponse.json((await rulesWithPublisherNames(db, [rule]))[0], { status: 201 });
}
