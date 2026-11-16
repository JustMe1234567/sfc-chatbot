import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { audit } from "@/api/audit";
import { listStaffMembers } from "@/api/staffMembers";
import { provisionStaffMember } from "@/auth/provision";
import type { StaffRole } from "@/auth/server";
import { getChatbotService } from "@/db/service";

/** The roster (owner + staff; editors hold answer permissions only). */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ members: await listStaffMembers(db) });
}

/**
 * Invite a named staff member by email. Creating additional owner accounts
 * stays with the trusted bootstrap command.
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
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    email?: unknown;
    role?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (name.length === 0 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: { code: "invalid_member", message: "Provide a name (max 80 characters) and a valid email." } },
      { status: 400 },
    );
  }
  if (role !== "staff" && role !== "editor") {
    return NextResponse.json(
      { error: { code: "invalid_role", message: "Invite a staff or editor account." } },
      { status: 400 },
    );
  }

  const service = await getChatbotService();
  try {
    const member = await provisionStaffMember(service.auth, service.db, {
      email,
      name,
      role: role as StaffRole,
    });
    await audit(service.store, guard.staff.userId, "staff_invited", {}, `${email} (${role})`);
    return NextResponse.json({ member, invitationStatus: "sent" }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exist|accepted|disabled|differently provisioned|unique/i.test(message)) {
      return NextResponse.json(
        { error: { code: "member_exists", message: "An account with this email already exists." } },
        { status: 409 },
      );
    }
    throw error;
  }
}
