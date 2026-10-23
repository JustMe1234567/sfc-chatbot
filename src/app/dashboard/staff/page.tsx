import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { listStaffMembers } from "@/api/staffMembers";
import { getChatbotService } from "@/db/service";
import InviteForm from "./invite-form";
import DisableButton from "./disable-button";
import styles from "../dashboard.module.css";

/** The owner's staff roster (ticket 08): invite, review, disable. */
export default async function StaffPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ["owner"] });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires the owner role.</p>
      </main>
    );
  }

  const { db } = await getChatbotService();
  const members = listStaffMembers(db);

  return (
    <main className={styles.shell}>
      <header className={styles.shellHeader}>
        <h1>Staff</h1>
        <div className={styles.whoami}>
          <Link href="/dashboard/inbox">Back to inbox</Link>
          <span>
            {guard.staff.name} · {guard.staff.role}
          </span>
        </div>
      </header>

      <div className={styles.inbox}>
        <InviteForm />
      </div>

      <div className={styles.inbox}>
        {members.map((member) => (
          <div key={member.id} className={styles.conversationCard}>
            <div className={styles.meta}>
              {member.name} · {member.role}
              {member.banned ? (
                <span className={styles.badge}>disabled</span>
              ) : (
                <span className={styles.publishedBadge}>active</span>
              )}
            </div>
            <div className={styles.preview}>{member.email}</div>
            <div className={styles.meta}>
              {member.twoFactorEnabled ? "second factor enrolled" : "second factor not enrolled"}
            </div>
            {!member.banned && member.role !== "owner" && member.id !== guard.staff.userId ? (
              <DisableButton memberId={member.id} name={member.name} />
            ) : null}
          </div>
        ))}
      </div>
    </main>
  );
}
