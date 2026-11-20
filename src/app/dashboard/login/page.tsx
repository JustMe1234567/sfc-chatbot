"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/** Single-stage staff sign-in: username and password are the whole flow
 * (ticket 82 removed the second factor). A hard navigation hands the fresh
 * session cookie to the dashboard's server components. */
export default function StaffLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.signIn.username({ username, password });
    setBusy(false);
    if (result.error) {
      setError("Sign-in failed. Check your username and password.");
      return;
    }
    window.location.assign("/dashboard/inbox");
  }

  return (
    <main className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={submitCredentials}>
        <h1 className={styles.srOnly}>Staff sign-in</h1>
        <div className={styles.loginBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cropped-SFC-Final-Logo-Single.png" alt="" />
          <span className={styles.loginBrandText}>
            <strong>Springfield College</strong>
            <span>Staff sign-in</span>
          </span>
        </div>
        <p className={styles.hint}>Chat dashboard. Staff accounts are created by an owner.</p>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value.toLowerCase())}
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
        <p className={styles.hint}>Contact an owner if you forget your password.</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
