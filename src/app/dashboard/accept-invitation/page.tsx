"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10 || password !== confirmation) {
      setError("Use at least 10 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await authClient.setPassword(password);
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push("/dashboard/enroll");
  }

  return (
    <main className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={submit}>
        <h1>Accept your invitation</h1>
        <p className={styles.hint}>Create your staff password, then enroll an authenticator.</p>
        <label htmlFor="new-password">Password</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required />
        <label htmlFor="confirm-password">Confirm password</label>
        <input id="confirm-password" type="password" autoComplete="new-password" minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
        <PendingButton type="submit" pending={busy} pendingLabel="Saving…">Continue</PendingButton>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
