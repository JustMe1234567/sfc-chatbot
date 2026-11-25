"use client";

import { useState } from "react";
import { useStaffAction } from "../use-staff-action";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Creates an Admissions Advisor account — the only role the dashboard
 * creates (ticket 102). The admin sets the username and the initial
 * password, so there is no role to choose and nothing is sent.
 */
export default function AccountForm() {
  const staff = useStaffAction();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (staff.busy) return;
    const result = await staff.run(
      () => fetch("/api/staff/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), username, password }),
      }),
      "Could not create the account.",
    );
    if (!result.ok) {
      setCreated(null);
      return;
    }
    setCreated(username);
    setName("");
    setUsername("");
    setPassword("");
  }

  const valid = name.trim().length > 0 && /^[a-z0-9._-]{3,32}$/.test(username) && password.length >= 10;
  return (
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Create an Admissions Advisor account</h2>
      <p className={styles.hint}>
        Share the username and password directly with the member. The password alone admits the dashboard.
      </p>
      <label htmlFor="account-name">Name</label>
      <input id="account-name" type="text" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required />
      <label htmlFor="account-username">Username</label>
      <input
        id="account-username"
        type="text"
        minLength={3}
        maxLength={32}
        pattern="[a-z0-9._-]+"
        autoComplete="off"
        value={username}
        onChange={(event) => setUsername(event.target.value.toLowerCase())}
        required
      />
      <label htmlFor="account-password">Password</label>
      <input id="account-password" type="password" minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <PendingButton type="submit" pending={staff.busy} pendingLabel="Creating…" disabled={!valid}>
        Create account
      </PendingButton>
      {created ? <p className={styles.hint} role="status">Account @{created} created.</p> : null}
      {staff.error ? <p className={styles.error} role="alert">{staff.error}</p> : null}
    </form>
  );
}
