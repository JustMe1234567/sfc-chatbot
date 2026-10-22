"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "../dashboard.module.css";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await authClient.signOut();
    router.push("/dashboard/login");
  }
  async function signOutEverywhere() {
    await fetch("/api/staff/sessions/revoke-all", { method: "POST" }).catch(() => {});
    router.push("/dashboard/login");
  }
  return (
    <>
      <button type="button" className={styles.signOut} onClick={signOut}>
        Sign out
      </button>
      <button type="button" className={styles.signOut} onClick={signOutEverywhere}>
        Sign out everywhere
      </button>
    </>
  );
}
