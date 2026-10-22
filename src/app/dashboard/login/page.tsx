"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "../dashboard.module.css";

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"credentials" | "totp">("credentials");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError("Sign-in failed. Check your email and password.");
      return;
    }
    const data = result.data as { twoFactorRedirect?: boolean; twoFactor?: boolean } | undefined;
    if (data?.twoFactorRedirect || data?.twoFactor) {
      setStage("totp");
      return;
    }
    // Signed in without a second factor: enrollment is mandatory.
    router.push("/dashboard/enroll");
  }

  async function submitTotp(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (result.error) {
      setError("That code was not accepted. Try the current code from your authenticator.");
      return;
    }
    router.push("/dashboard/inbox");
  }

  return (
    <main className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={submitCredentials}>
        <h1>Staff sign-in</h1>
        <p className={styles.hint}>Example College chat dashboard. Staff accounts are invite-only.</p>
        {stage === "credentials" ? (
          <>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="submit" disabled={busy}>
              Sign in
            </button>
          </>
        ) : (
          <>
            <label htmlFor="totp">Authenticator code</label>
            <input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <button type="submit" onClick={submitTotp} disabled={busy}>
              Verify code
            </button>
          </>
        )}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
