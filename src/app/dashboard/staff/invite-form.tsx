"use client";

import { useState } from "react";
import { useStaffAction } from "../use-staff-action";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Owner invite form. Supabase sends the acceptance link and password setup
 * instructions to the named member.
 */
export default function InviteForm() {
  const staff = useStaffAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "editor">("staff");
  const [invited, setInvited] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (staff.busy || name.trim().length === 0 || email.trim().length === 0) {
      return;
    }
    const result = await staff.run(
      () =>
        fetch("/api/staff/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
        }),
      "Could not invite the member.",
    );
    if (!result.ok) {
      setInvited(null);
      return;
    }
    setInvited(email.trim());
    setName("");
    setEmail("");
    setRole("staff");
  }

  return (
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Invite a staff member</h2>
      <p className={styles.hint}>
        The member receives a secure email link to set a password and enroll
        an authenticator before dashboard access is granted.
      </p>
      <label htmlFor="invite-name">Name</label>
      <input
        id="invite-name"
        type="text"
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="invite-email">Email</label>
      <input
        id="invite-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="invite-role">Role</label>
      <select
        id="invite-role"
        value={role}
        onChange={(event) => setRole(event.target.value as "staff" | "editor")}
      >
        <option value="staff">Staff (inbox, replies)</option>
        <option value="editor">Editor (answers only)</option>
      </select>
      <PendingButton
        type="submit"
        pending={staff.busy}
        pendingLabel="Sending…"
        disabled={name.trim().length === 0 || email.trim().length === 0}
      >
        Send invitation
      </PendingButton>
      {invited ? (
        <div className={styles.publishBar} role="status">
          <span className={styles.hint}>Invitation sent to {invited}.</span>
        </div>
      ) : null}
      {staff.error ? (
        <p className={styles.hint} role="alert">
          {staff.error}
        </p>
      ) : null}
    </form>
  );
}
