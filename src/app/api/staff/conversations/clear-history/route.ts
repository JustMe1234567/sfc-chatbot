import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { getChatbotService } from "@/db/service";

/**
 * Owner-only bulk clear of the History tab (ticket 51): hard-deletes every
 * closed conversation at once, through the same transactional purge as the
 * retention sweep. Claimed and waiting rows survive — only the archive of
 * finished conversations is removed — and each purge refuses non-closed
 * states on its own, so a conversation reopened mid-loop is skipped.
 */
export async function POST(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }

  const { store } = await getChatbotService();
  // Only closed conversations are enumerated — claimed and waiting rows are
  // never even loaded for the clear.
  const closed = await store.listConversationsByState("closed");
  let removed = 0;
  for (const conversation of closed) {
    if (await store.purgeClosedConversation(conversation.id)) {
      removed += 1;
    }
  }
  return NextResponse.json({ ok: true, removed });
}
