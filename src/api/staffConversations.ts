import { NextResponse } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";
import type { Conversation } from "@/domain/types";
import type { StaffContext } from "@/api/staff";

export interface LoadedConversation {
  conversation: Conversation;
  staff: StaffContext;
  claimerName: string | null;
}

export type LoadedConversationResult =
  | LoadedConversation
  | { response: NextResponse };

/** Display name of a staff account, for claim-conflict messages. */
export function staffName(db: DatabaseSync, userId: string): string | null {
  return (
    (db.prepare('SELECT "name" FROM "user" WHERE "id" = ?').get(userId) as
      | { name: string }
      | undefined)?.name ?? null
  );
}

/**
 * Loads a conversation for a staff action: session, active account, role, and
 * existence all verified. Returns the conversation plus the display name of
 * its current claimer (from the staff account table) so losers of a claim
 * race see who owns the work.
 */
export async function loadStaffConversation(
  requestHeaders: Headers,
  conversationId: string,
): Promise<LoadedConversationResult> {
  const guard = await requireStaff(requestHeaders, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard;
  }
  const { store, db } = await getChatbotService();
  const conversation = await store.getConversation(conversationId);
  if (!conversation) {
    return {
      response: NextResponse.json(
        { error: { code: "conversation_not_found", message: "Conversation not found." } },
        { status: 404 },
      ),
    };
  }
  const claimerName = conversation.claimedBy ? staffName(db, conversation.claimedBy) : null;
  return { conversation, staff: guard.staff, claimerName };
}

export function claimConflictResponse(claimerName: string | null): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "already_claimed",
        message: claimerName
          ? `${claimerName} is already helping in this conversation.`
          : "This conversation is already claimed.",
      },
      claimedBy: claimerName,
    },
    { status: 409 },
  );
}
