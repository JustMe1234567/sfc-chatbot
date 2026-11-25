import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { getChatbotService } from "@/db/service";
import { historyQuietBefore, isConversationActive } from "@/domain/activity";

/**
 * Owner-only bulk clear of the History tab (ticket 51, widened by ticket 62):
 * hard-deletes every History conversation — closed ones and those quiet
 * past the inactivity window in any stored state — through the same
 * transactional purge as the retention sweep. Live conversations are never
 * enumerated, and each purge rechecks History membership on its own, so a
 * conversation that turns live mid-loop is kept.
 */
export async function POST(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }

  const { store } = await getChatbotService();
  const now = new Date();
  // The History tab's own rule (isConversationActive), so the dialog's count
  // and the clear agree.
  const history = (await store.listConversations()).filter(
    (conversation) => !isConversationActive(conversation, now),
  );
  const quietBefore = historyQuietBefore(now);
  let removed = 0;
  for (const conversation of history) {
    if (await store.purgeHistoryConversation(conversation.id, quietBefore)) {
      removed += 1;
    }
  }
  return NextResponse.json({ ok: true, removed });
}
