"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<"totp" | "password">("totp");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void authClient.getSession().then((result) => {
      if (result.data?.user.twoFactorEnabled === false) setStage("password");
    });
  }, []);

  async function submitTotp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (result.error) {
      setError("That code was not accepted. Contact an owner if your authenticator is lost.");
      return;
    }
    setStage("password");
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10 || password !== confirmation) {
      setError("Use at least 10 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await authClient.resetPassword(password);
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push("/dashboard/login");
  }

  return (
    <main className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={stage === "totp" ? submitTotp : submitPassword}>
        <h1>Reset your password</h1>
        {stage === "totp" ? (
          <>
            <p className={styles.hint}>Password recovery still requires your enrolled authenticator.</p>
            <label htmlFor="reset-totp">Authenticator code</label>
            <input id="reset-totp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} required />
            <PendingButton type="submit" pending={busy} pendingLabel="Verifying…">Verify code</PendingButton>
          </>
        ) : (
          <>
            <label htmlFor="reset-password">New password</label>
            <input id="reset-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required />
            <label htmlFor="reset-confirmation">Confirm new password</label>
            <input id="reset-confirmation" type="password" autoComplete="new-password" minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
            <PendingButton type="submit" pending={busy} pendingLabel="Resetting…">Reset password</PendingButton>
          </>
        )}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
