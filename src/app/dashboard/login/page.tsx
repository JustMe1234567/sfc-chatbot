"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"credentials" | "totp" | "forgot">("credentials");
  const [notice, setNotice] = useState("");
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
    if (result.data?.twoFactorRedirect) {
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

  async function submitForgot(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    await authClient.forgetPassword(email);
    setBusy(false);
    setNotice("If that address belongs to an active staff account, a recovery email has been sent.");
  }

  return (
    <main className={styles.loginShell}>
      <form
        className={styles.loginCard}
        onSubmit={stage === "totp" ? submitTotp : stage === "forgot" ? submitForgot : submitCredentials}
      >
        <h1 className={styles.srOnly}>Staff sign-in</h1>
        <div className={styles.loginBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cropped-SFC-Final-Logo-Single.png" alt="" />
          <span className={styles.loginBrandText}>
            <strong>Springfield College</strong>
            <span>Staff sign-in</span>
          </span>
        </div>
        <p className={styles.hint}>Chat dashboard. Staff accounts are invite-only.</p>
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
            <PendingButton type="submit" pending={busy} pendingLabel="Signing in…">
              Sign in
            </PendingButton>
            <button type="button" className={styles.ghostButton} onClick={() => setStage("forgot")}>
              Forgot password?
            </button>
          </>
        ) : stage === "totp" ? (
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
            <PendingButton
              type="submit"
              pending={busy}
              pendingLabel="Verifying…"
            >
              Verify code
            </PendingButton>
          </>
        ) : (
          <>
            <label htmlFor="recovery-email">Email</label>
            <input
              id="recovery-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <PendingButton type="submit" pending={busy} pendingLabel="Sending…">
              Send recovery email
            </PendingButton>
            <button type="button" className={styles.ghostButton} onClick={() => setStage("credentials")}>
              Back to sign in
            </button>
          </>
        )}
        {notice ? <p className={styles.hint} role="status">{notice}</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
