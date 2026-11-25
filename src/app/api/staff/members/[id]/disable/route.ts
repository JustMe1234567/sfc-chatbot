import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface TargetRow {
  id: string;
  username: string;
  role: string;
  supabaseUserId: string | null;
}

/**
 * Disable (ticket 08): an admin disables an Admissions Advisor account.
 * Access ends immediately: every session row is revoked (polling stops
 * authing) and the per-request ban check in requireStaff keeps even a stolen
 * cookie out. Admin accounts and the acting admin are not disable targets —
 * the Admin lifecycle stays with the server-side bootstrap procedure.
 */
export async function POST(request: Request, context: RouteContext) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { id } = await context.params;
  if (id === guard.staff.userId) {
    return NextResponse.json(
      { error: { code: "invalid_target", message: "You cannot disable your own account." } },
      { status: 400 },
    );
  }

  const service = await getChatbotService();
  const target = await service.db
    .get<TargetRow>('SELECT "id", "username", "role", "supabaseUserId" FROM staff_members WHERE "id" = ?', id);
  if (!target) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Account not found." } },
      { status: 404 },
    );
  }
  if (target.role === "admin") {
    return NextResponse.json(
      { error: { code: "invalid_target", message: "Admin accounts are managed by the bootstrap procedure." } },
      { status: 400 },
    );
  }

  // Trusted server context (like provisioning): flip the ban flag directly.
  // requireStaff checks it on every request, and deleting the session rows
  // ends live access immediately, including dashboard polling. The flag is
  // a portable boolean bind (0/1 on SQLite, true/false on Postgres).
  await service.db.run(
    'UPDATE staff_members SET "banned" = ?, "banReason" = ? WHERE "id" = ?',
    true,
    "Disabled by the owner",
    id,
  );
  if (target.supabaseUserId) {
    await service.auth.disable(target.supabaseUserId);
  }
  await audit(service.store, guard.staff.userId, "staff_disabled", {}, target.username);

  // Their claims cannot survive them: release each conversation back to the
  // shared inbox so another admissions advisor can pick it up, with the sweep
  // recorded on the trail.
  const claimed = await service.store.listConversationsByState("claimed");
  for (const conversation of claimed) {
    if (conversation.claimedBy !== id) {
      continue;
    }
    const released = await service.store.releaseConversation(conversation.id);
    if (released) {
      await audit(
        service.store,
        guard.staff.userId,
        "conversation_released",
        { conversationId: conversation.id },
        `released from the disabled account of ${target.username}`,
      );
    }
  }
  return NextResponse.json({ member: { id: target.id, username: target.username, disabled: true } });
}
