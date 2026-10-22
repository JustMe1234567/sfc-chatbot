import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";

export default async function DashboardEntry() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders);
  if ("staff" in guard) {
    redirect("/dashboard/inbox");
  }
  // No acceptable session: the login page also routes unenrolled staff to
  // second-factor setup after a successful password sign-in.
  redirect("/dashboard/login");
}
