"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function SignOutButton() {
  const router = useRouter();
  const [signOutPending, setSignOutPending] = useState(false);
  const [revokePending, setRevokePending] = useState(false);
  async function signOut() {
    setSignOutPending(true);
    await authClient.signOut();
    router.push("/dashboard/login");
  }
  async function signOutEverywhere() {
    setRevokePending(true);
    await fetch("/api/staff/sessions/revoke-all", { method: "POST" }).catch(() => {});
    router.push("/dashboard/login");
  }
  return (
    <>
      <PendingButton
        type="button"
        className={styles.secondaryButton}
        pending={signOutPending}
        pendingLabel="Signing out…"
        disabled={revokePending}
        onClick={signOut}
      >
        Sign out
      </PendingButton>
      <PendingButton
        type="button"
        className={styles.ghostButton}
        pending={revokePending}
        pendingLabel="Revoking sessions…"
        disabled={signOutPending}
        onClick={signOutEverywhere}
      >
        Sign out everywhere
      </PendingButton>
    </>
  );
}
