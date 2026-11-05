import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule } from "@/api/staffAnswerRules";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Permanently delete (ticket 58): a Trash-only action — active or archived
 * answers must go through Delete first (409 otherwise), so nothing can
 * vanish from the live lists in one irreversible step. Owners and Editors
 * alike reach this through the shared answer-rule roles. The rule row is
 * removed for good after its audit detachment (the store keeps the
 * accountability record), and transcripts are untouched.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }
  if (loaded.rule.status !== "trashed") {
    return NextResponse.json(
      { error: { code: "not_trashed", message: "Only trashed answers can be permanently deleted." } },
      { status: 409 },
    );
  }

  const { store } = await getChatbotService();
  await audit(store, loaded.staff.userId, "rule_purged", { ruleId: id });
  await store.deleteAnswerRule(id);
  return NextResponse.json({ ok: true });
}
