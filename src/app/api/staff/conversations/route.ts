import { NextResponse } from "next/server";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { summarizeSharedInbox } from "@/domain/inbox";
import { sweepTranscripts } from "@/domain/retention";
import { getChatbotService } from "@/db/service";

/**
 * The shared inbox: unclaimed escalations awaiting a staff reply.
 * Read access requires the owner or staff role.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }

  const { store, db } = await getChatbotService();
  // Ordinary staff traffic drives the automated transcript cleanup (ticket
  // 10): expired conversations leave the dashboard without needing a
  // scheduler beside the SQLite store.
  await sweepTranscripts(db, store);
  const conversations = await summarizeSharedInbox(store);
  return NextResponse.json({ conversations });
}
