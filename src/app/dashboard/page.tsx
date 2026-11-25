import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";

export default async function DashboardEntry() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders);
  if ("staff" in guard) {
    // Both roles work the desk (ticket 102), so the front door sends
    // everyone to the inbox.
    redirect("/dashboard/inbox");
  }
  // No acceptable session: sign-in is a single username + password stage.
  redirect("/dashboard/login");
}
