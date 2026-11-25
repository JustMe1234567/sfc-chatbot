import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import { staffRoleLabel } from "@/auth/server";
import DashboardHeader from "../header";
import { listStaffMembers } from "@/api/staffMembers";
import { getChatbotService } from "@/db/service";
import AccountForm from "./account-form";
import CredentialActions from "./credential-actions";
import DisableButton from "./disable-button";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Staff accounts" };


/**
 * The admin's Staff accounts roster (ticket 08): create Admissions Advisor
 * accounts, reset their passwords, and disable them. Admin accounts appear
 * in the roster but carry no controls — they are managed only by the
 * bootstrap command (ticket 102).
 */
export default async function StaffPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ["admin"] });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires the admin role.</p>
      </main>
    );
  }

  const { db } = await getChatbotService();
  const members = await listStaffMembers(db);

  return (
    <main className={styles.shell}>
      <DashboardHeader area="staff" title="Staff accounts" name={guard.staff.name} role={guard.staff.role} />

      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <div className={styles.inbox}>
          <AccountForm />
        </div>

        <div className={styles.inbox}>
          {members.map((member) => (
            <div key={member.id} className={styles.conversationCard}>
              <div className={styles.meta}>
                {member.name} · {staffRoleLabel(member.role)}
                {member.banned ? (
                  <span className={styles.badge}>disabled</span>
                ) : (
                  <span className={styles.publishedBadge}>active</span>
                )}
              </div>
              <div className={styles.preview}>@{member.username}</div>
              {!member.banned && member.role !== "admin" && member.id !== guard.staff.userId ? (
                <>
                  <CredentialActions memberId={member.id} name={member.name} />
                  <DisableButton memberId={member.id} name={member.name} />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
