"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "../dashboard.module.css";

/**
 * Mandatory second-factor enrollment. A staff member who signed in with only
 * a password reaches this page, enrolls an authenticator, confirms one code,
 * and is then signed out so the next sign-in exercises the full password +
 * TOTP flow.
 */
export default function EnrollPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnrollment(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.twoFactor.enable({
      password,
      method: "totp",
      issuer: "Example College chat",
    });
    setBusy(false);
    const uri = result.data && "totpURI" in result.data ? result.data.totpURI : null;
    if (result.error || !uri) {
      setError("Enrollment failed. Check your password and try again.");
      return;
    }
    const url = new URL(uri);
    setTotpUri(uri);
    setSecret(url.searchParams.get("secret"));
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.twoFactor.verifyTotp({ code });
    if (result.error) {
      setBusy(false);
      setError("That code was not accepted. Try the current code from your authenticator.");
      return;
    }
    // Force a fresh sign-in that exercises the second factor.
    await authClient.signOut();
    setBusy(false);
    router.push("/dashboard/login");
  }

  return (
    <main className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={totpUri ? confirmCode : startEnrollment}>
        <h1>Set up your second factor</h1>
        <p className={styles.hint}>
          A second factor is required for all staff. Use any authenticator app that supports
          time-based one-time passwords.
        </p>
        {totpUri ? (
          <>
            <p className={styles.hint}>
              Scan this secret into your authenticator app, then enter the current code.
            </p>
            <code>{secret}</code>
            <label htmlFor="totp">Authenticator code</label>
            <input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <button type="submit" disabled={busy}>
              Confirm code and sign out
            </button>
          </>
        ) : (
          <>
            <label htmlFor="password">Confirm your password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button type="submit" disabled={busy}>
              Begin enrollment
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
