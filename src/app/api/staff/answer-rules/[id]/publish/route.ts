import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Publishing is the review act: the current staff account approves this exact
 * content for visitors, which stamps who published it and when. The visitor
 * matcher reads published rules from the store per question, so the change is
 * live immediately, with no redeploy.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }
  const { rule: existing, staff } = loaded;

  const now = new Date().toISOString();
  const rule: AnswerRule = {
    ...existing,
    status: "published",
    updatedAt: now,
    publishedBy: staff.userId,
    reviewedAt: now,
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  return NextResponse.json(rulesWithPublisherNames(db, [rule])[0]);
}
