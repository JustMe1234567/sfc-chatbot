import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";

export default async function DashboardEntry() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders);
  if ("staff" in guard) {
    // Editors hold answer-rule permissions but not inbox access, so the
    // dashboard's front door sends each role to its own workspace.
    redirect(guard.staff.role === "editor" ? "/dashboard/answers" : "/dashboard/inbox");
  }
  // No acceptable session: sign-in is a single username + password stage.
  redirect("/dashboard/login");
}
