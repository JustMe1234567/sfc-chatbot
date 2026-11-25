import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { audit } from "@/api/audit";
import { listStaffMembers } from "@/api/staffMembers";
import { provisionStaffMember } from "@/auth/provision";
import { getChatbotService } from "@/db/service";

/** The roster — Admin-only, the same gate as the Staff accounts page. */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ members: await listStaffMembers(db) });
}

/**
 * Create an Admissions Advisor account with admin-set credentials. The
 * advisor is the only role the dashboard creates: Admin accounts come from
 * the trusted bootstrap command alone (ticket 102), so a request naming any
 * other role is refused.
 */
export async function POST(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
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
  // The form sends no role; a request may name the advisor role explicitly.
  const role = typeof body?.role === "string" ? body.role : "admissions_advisor";
  if (name.length === 0 || name.length > 80 || !/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 10) {
    return NextResponse.json(
      { error: { code: "invalid_member", message: "Provide a name, a valid username, and a password of at least 10 characters." } },
      { status: 400 },
    );
  }
  if (role !== "admissions_advisor") {
    return NextResponse.json(
      { error: { code: "invalid_role", message: "Only Admissions Advisor accounts can be created here." } },
      { status: 400 },
    );
  }

  const service = await getChatbotService();
  try {
    const member = await provisionStaffMember(service.auth, service.db, {
      username,
      password,
      name,
      role: "admissions_advisor",
    });
    await audit(service.store, guard.staff.userId, "staff_created", {}, `${username} (admissions_advisor)`);
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
