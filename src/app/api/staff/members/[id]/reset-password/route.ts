import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { isStaffBanned, requireStaff, sameOriginGuard } from "@/api/staff";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const blocked = sameOriginGuard(request);
  if (blocked) return blocked;
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) return guard.response;

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 10) {
    return NextResponse.json(
      { error: { code: "invalid_password", message: "Password must be at least 10 characters." } },
      { status: 400 },
    );
  }

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
      { error: { code: "not_found", message: "Account not found." } },
      { status: 404 },
    );
  }
  if (target.role === "admin" || !target.supabaseUserId || isStaffBanned(target.banned)) {
    return NextResponse.json(
      { error: { code: "invalid_target", message: "Only active Admissions Advisor passwords can be reset here." } },
      { status: 400 },
    );
  }

  await service.auth.resetPassword(target.supabaseUserId, password);
  await audit(service.store, guard.staff.userId, "staff_password_reset", {}, target.username);
  return NextResponse.json({ success: true });
}
