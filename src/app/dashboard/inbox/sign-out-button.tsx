"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * The signed-in identity's sign-out pair (ticket 08). `icon` is the
 * sidebar's inline arrow mark (ticket 52); it renders before the label so
 * the collapsed rail can shrink the control to the icon alone.
 */
export default function SignOutButton({ icon }: { icon?: ReactNode }) {
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
        {icon}
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
