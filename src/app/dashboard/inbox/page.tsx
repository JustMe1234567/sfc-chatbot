import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { roleLabel, summarizeSharedInbox } from "@/domain/inbox";
import { getChatbotService } from "@/db/service";
import SignOutButton from "./sign-out-button";
import styles from "../dashboard.module.css";

export default async function InboxPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized staff session.</p>
      </main>
    );
  }

  const { store } = await getChatbotService();
  const items = await summarizeSharedInbox(store);

  return (
    <main className={styles.shell}>
      <header className={styles.shellHeader}>
        <h1>Shared inbox</h1>
        <div className={styles.whoami}>
          <Link href="/dashboard/notifications">Email alerts</Link>
          <span>
            {guard.staff.name} · {guard.staff.role}
          </span>
          <SignOutButton />
        </div>
      </header>
      {items.length === 0 ? (
        <p className={styles.empty}>No conversations are waiting for staff.</p>
      ) : (
        <div className={styles.inbox}>
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/conversations/${item.id}`}
              className={styles.conversationCard}
            >
              <div className={styles.meta}>
                {new Date(item.createdAt).toLocaleString("en-GB")}
                <span className={styles.badge}>awaiting staff</span>
              </div>
              <div className={styles.preview}>
                {item.lastMessage
                  ? `${roleLabel(item.lastMessage.role)}: ${item.lastMessage.text.slice(0, 120)}`
                  : "No messages"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
