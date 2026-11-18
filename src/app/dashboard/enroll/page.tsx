"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Mandatory second-factor enrollment. A staff member who signed in with only
 * a password reaches this page, enrolls an authenticator, confirms one code,
 * and is then signed out so the next sign-in exercises the full password +
 * TOTP flow.
 */
export default function EnrollPage() {
  const router = useRouter();
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startEnrollment(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.twoFactor.enable();
    setBusy(false);
    const uri = result.data && "totpURI" in result.data ? result.data.totpURI : null;
    if (result.error || !uri) {
      setError("Enrollment failed. Sign in again and retry.");
      return;
    }
    const url = new URL(uri);
    setTotpUri(uri);
    setQrCode(result.data?.qrCode ?? null);
    setFactorId(result.data?.factorId ?? null);
    setSecret(url.searchParams.get("secret"));
  }

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const result = await authClient.twoFactor.verifyTotp({ code, ...(factorId ? { factorId } : {}) });
    if (result.error) {
      setBusy(false);
      setError(result.error.message || "That code was not accepted. Try the current code from your authenticator.");
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
        <h1 className={styles.srOnly}>Set up your second factor</h1>
        <div className={styles.loginBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cropped-SFC-Final-Logo-Single.png" alt="" />
          <span className={styles.loginBrandText}>
            <strong>Springfield College</strong>
            <span>Second factor</span>
          </span>
        </div>
        <p className={styles.hint}>
          A second factor is required for all staff. Use any authenticator app that supports
          time-based one-time passwords.
        </p>
        {totpUri ? (
          <>
            <p className={styles.hint}>
              Scan this secret into your authenticator app, then enter the current code.
            </p>
            {qrCode ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrCode.startsWith("data:") ? qrCode : `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`}
                alt="Authenticator QR code"
              />
            ) : null}
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
            <PendingButton type="submit" pending={busy} pendingLabel="Verifying…">
              Confirm code and sign out
            </PendingButton>
          </>
        ) : (
          <PendingButton type="submit" pending={busy} pendingLabel="Preparing…">
            Begin enrollment
          </PendingButton>
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
