import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface TargetRow {
  id: string;
  email: string;
  role: string;
}

/**
 * Disable (ticket 08): the owner bans a named account. Access ends
 * immediately: every session row is revoked (polling stops authing) and the
 * per-request ban check in requireStaff keeps even a stolen cookie out.
 * Owner accounts and the acting owner are not disable targets — owner
 * lifecycle stays with the server-side bootstrap procedure.
 */
export async function POST(request: Request, context: RouteContext) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
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
    .get<TargetRow>('SELECT "id", "email", "role" FROM "user" WHERE "id" = ?', id);
  if (!target) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Staff account not found." } },
      { status: 404 },
    );
  }
  if (target.role === "owner") {
    return NextResponse.json(
      { error: { code: "invalid_target", message: "Owner accounts are managed by the bootstrap procedure." } },
      { status: 400 },
    );
  }

  // Trusted server context (like provisioning): flip the ban flag directly.
  // requireStaff checks it on every request, and deleting the session rows
  // ends live access immediately, including dashboard polling. The flag is
  // a portable boolean bind (0/1 on SQLite, true/false on Postgres).
  await service.db.run(
    'UPDATE "user" SET "banned" = ?, "banReason" = ? WHERE "id" = ?',
    true,
    "Disabled by the owner",
    id,
  );
  await service.db.run('DELETE FROM "session" WHERE "userId" = ?', id);
  await audit(service.store, guard.staff.userId, "staff_disabled", {}, target.email);

  // Their claims cannot survive them: release each conversation back to the
  // shared inbox so another staff member can pick it up, with the sweep
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
        `released from the disabled account of ${target.email}`,
      );
    }
  }
  return NextResponse.json({ member: { id: target.id, email: target.email, disabled: true } });
}
