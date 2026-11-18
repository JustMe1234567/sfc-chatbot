"use client";

import { useState } from "react";
import ConfirmDialog from "../confirm-dialog";
import PendingButton from "../pending-button";
import { useStaffAction } from "../use-staff-action";
import styles from "../dashboard.module.css";

export default function CredentialActions({ memberId, name }: { memberId: string; name: string }) {
  const staff = useStaffAction();
  const [password, setPassword] = useState("");
  const [resettingMfa, setResettingMfa] = useState(false);
  const [notice, setNotice] = useState("");

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    const result = await staff.run(
      () => fetch(`/api/staff/members/${memberId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
      "Could not reset the password.",
    );
    if (result.ok) {
      setPassword("");
      setNotice(`${name}'s password was reset and all sessions were signed out.`);
    }
  }

  async function resetMfa() {
    const result = await staff.run(
      () => fetch(`/api/staff/members/${memberId}/reset-mfa`, { method: "POST" }),
      "Could not reset the authenticator.",
    );
    if (result.ok) {
      setResettingMfa(false);
      setNotice(`${name} must enroll a new authenticator at the next sign-in.`);
    }
  }

  return (
    <div>
      <form onSubmit={resetPassword}>
        <label htmlFor={`reset-password-${memberId}`}>New password for {name}</label>
        <input
          id={`reset-password-${memberId}`}
          type="password"
          minLength={10}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PendingButton type="submit" pending={staff.busy} pendingLabel="Resetting…" disabled={password.length < 10}>
          Reset password
        </PendingButton>
      </form>
      <button type="button" className={styles.ghostButton} onClick={() => setResettingMfa(true)}>
        Reset authenticator
      </button>
      {resettingMfa ? (
        <ConfirmDialog
          title={`Reset ${name}'s authenticator?`}
          confirmLabel="Reset authenticator"
          pendingLabel="Resetting…"
          pending={staff.busy}
          error={staff.error}
          onCancel={() => setResettingMfa(false)}
          onConfirm={() => void resetMfa()}
        >
          This signs the member out everywhere and requires a new authenticator enrollment.
        </ConfirmDialog>
      ) : null}
      {notice ? <p className={styles.hint} role="status">{notice}</p> : null}
      {staff.error ? <p className={styles.error} role="alert">{staff.error}</p> : null}
    </div>
  );
}
