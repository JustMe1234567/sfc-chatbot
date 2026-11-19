"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function PasswordSettings() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10 || password !== confirmation) {
      setError("Use at least 10 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await authClient.changePassword(password);
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    // Ticket 82 review amendment: a self-service change revokes no sessions,
    // so the member stays signed in right where they are.
    setChanged(true);
    setPassword("");
    setConfirmation("");
  }

  return (
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Change password</h2>
      <p className={styles.hint}>
        Changing your password keeps your sessions — including this one — signed in. Only an
        owner-issued reset signs out every session.
      </p>
      <label htmlFor="own-new-password">New password</label>
      <input id="own-new-password" type="password" minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <label htmlFor="own-confirm-password">Confirm new password</label>
      <input id="own-confirm-password" type="password" minLength={10} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
      <PendingButton type="submit" pending={busy} pendingLabel="Changing…">Change password</PendingButton>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {changed ? <p className={styles.hint} role="status">Password changed.</p> : null}
    </form>
  );
}
