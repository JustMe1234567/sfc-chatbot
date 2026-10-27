import { NextResponse } from "next/server";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { summarizeConversationDesk, summarizeConversationHistory } from "@/domain/inbox";
import { sweepTranscripts } from "@/domain/retention";
import { expireAnalytics } from "@/domain/analytics";
import { getChatbotService } from "@/db/service";

/**
 * The conversation desk list (ticket 12): Incoming holds the waiting
 * escalations, Active holds bot-active and claimed chats (claiming never
 * removes a conversation), and `?view=history` returns everything that left
 * the active lists — quiet for a day or closed — with transcripts kept.
 * Read access requires the owner or staff role.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }

  const { store, db } = await getChatbotService();
  // Ordinary staff traffic drives the automated transcript cleanup (ticket
  // 10) and the analytics expiry (ticket 17, on its own retention period):
  // expired data leaves without needing a scheduler beside the SQLite store.
  await sweepTranscripts(db, store);
  await expireAnalytics(db, store);
  const view = new URL(request.url).searchParams.get("view");
  if (view === "history") {
    return NextResponse.json({ conversations: await summarizeConversationHistory(store) });
  }
  return NextResponse.json(await summarizeConversationDesk(store));
}
