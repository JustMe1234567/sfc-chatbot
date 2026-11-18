"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function PasswordSettings() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    router.push("/dashboard/login");
  }

  return (
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Change password</h2>
      <p className={styles.hint}>Changing your password signs out every active session.</p>
      <label htmlFor="own-new-password">New password</label>
      <input id="own-new-password" type="password" minLength={10} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <label htmlFor="own-confirm-password">Confirm new password</label>
      <input id="own-confirm-password" type="password" minLength={10} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
      <PendingButton type="submit" pending={busy} pendingLabel="Changing…">Change password</PendingButton>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </form>
  );
}
