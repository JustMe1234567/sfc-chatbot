"use client";

import { useState } from "react";
import PendingButton from "../pending-button";
import { useStaffAction } from "../use-staff-action";
import styles from "../dashboard.module.css";

export default function CredentialActions({ memberId, name }: { memberId: string; name: string }) {
  const staff = useStaffAction();
  const [password, setPassword] = useState("");
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
      {notice ? <p className={styles.hint} role="status">{notice}</p> : null}
      {staff.error ? <p className={styles.error} role="alert">{staff.error}</p> : null}
    </div>
  );
}
