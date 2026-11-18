import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const blocked = sameOriginGuard(request);
  if (blocked) return blocked;
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) return guard.response;

  const { id } = await context.params;
  const service = await getChatbotService();
  const target = await service.db.get<{
    id: string;
    username: string;
    role: string;
    banned: unknown;
    supabaseUserId: string | null;
  }>(
    `SELECT "id", "username", "role", "banned", "supabaseUserId"
     FROM staff_members WHERE "id" = ?`,
    id,
  );
  if (!target) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Staff account not found." } },
      { status: 404 },
    );
  }
  if (target.role === "owner" || !target.supabaseUserId || target.banned === true || target.banned === 1) {
    return NextResponse.json(
      { error: { code: "invalid_target", message: "Only active staff and editor authenticators can be reset here." } },
      { status: 400 },
    );
  }

  await service.auth.resetMfa(target.supabaseUserId);
  await service.db.run(
    `UPDATE staff_members SET "twoFactorEnabled" = ?, "mfaRecoveryApprovedAt" = NULL, "updatedAt" = ?
     WHERE "id" = ?`,
    false,
    new Date().toISOString(),
    target.id,
  );
  await audit(service.store, guard.staff.userId, "staff_mfa_reset", {}, target.username);
  return NextResponse.json({ success: true });
}
