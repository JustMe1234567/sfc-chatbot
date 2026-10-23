"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

/**
 * Owner invite form (ticket 08). The server generates the initial password;
 * it is displayed exactly once here for the owner to share out of band.
 */
export default function InviteForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "editor">("staff");
  const [initialPassword, setInitialPassword] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length === 0 || email.trim().length === 0) {
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/staff/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
    });
    setBusy(false);
    if (!response.ok) {
      setInitialPassword(null);
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "Could not invite the member.");
      return;
    }
    const body = (await response.json()) as { initialPassword: string };
    setInitialPassword(body.initialPassword);
    setName("");
    setEmail("");
    setRole("staff");
    router.refresh();
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
      <button type="submit" disabled={busy || name.trim().length === 0 || email.trim().length === 0}>
        Create account
      </button>
      {initialPassword ? (
        <div className={styles.publishBar} role="status">
          <span className={styles.hint}>Initial password (shown once):</span>
          <code>{initialPassword}</code>
        </div>
      ) : null}
      {message ? (
        <p className={styles.hint} role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
