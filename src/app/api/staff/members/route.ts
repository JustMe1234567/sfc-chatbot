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
 * Create a named staff account with owner-managed credentials. Additional owner accounts
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
    username?: unknown;
    password?: unknown;
    role?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (name.length === 0 || name.length > 80 || !/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 10) {
    return NextResponse.json(
      { error: { code: "invalid_member", message: "Provide a name, a valid username, and a password of at least 10 characters." } },
      { status: 400 },
    );
  }
  if (role !== "staff" && role !== "editor") {
    return NextResponse.json(
      { error: { code: "invalid_role", message: "Choose a staff or editor account." } },
      { status: 400 },
    );
  }

  const service = await getChatbotService();
  try {
    const member = await provisionStaffMember(service.auth, service.db, {
      username,
      password,
      name,
      role: role as StaffRole,
    });
    await audit(service.store, guard.staff.userId, "staff_created", {}, `${username} (${role})`);
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exist|accepted|disabled|differently provisioned|unique/i.test(message)) {
      return NextResponse.json(
        { error: { code: "member_exists", message: "An account with this username already exists." } },
        { status: 409 },
      );
    }
    throw error;
  }
}
