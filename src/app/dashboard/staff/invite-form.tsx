"use client";

import { useState } from "react";
import { useStaffAction } from "../use-staff-action";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Owner invite form (ticket 08). The server generates the initial password;
 * it is displayed exactly once here for the owner to share out of band.
 */
export default function InviteForm() {
  const staff = useStaffAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "editor">("staff");
  const [initialPassword, setInitialPassword] = useState<string | null>(null);

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
      setInitialPassword(null);
      return;
    }
    const body = result.body as { initialPassword: string };
    setInitialPassword(body.initialPassword);
    setName("");
    setEmail("");
    setRole("staff");
  }

  return (
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Invite a staff member</h2>
      <p className={styles.hint}>
        The initial password is shown once: share it with the person securely.
        Their first sign-in forces authenticator setup, like every account.
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
        pendingLabel="Creating…"
        disabled={name.trim().length === 0 || email.trim().length === 0}
      >
        Create account
      </PendingButton>
      {initialPassword ? (
        <div className={styles.publishBar} role="status">
          <span className={styles.hint}>Initial password (shown once):</span>
          <code>{initialPassword}</code>
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
