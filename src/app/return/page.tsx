"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { writeSession, type StoredSession } from "@/lib/visitorSession";
import styles from "../widget/frame/frame.module.css";

/**
 * Landing page for the emailed return link (ticket 07). It redeems the
 * one-time token for a fresh visitor credential, stores it exactly where the
 * chat frame looks, and opens the conversation. An expired or already-used
 * link explains itself and offers a fresh chat instead.
 */
export default function ReturnPage() {
  const router = useRouter();
  const [state, setState] = useState<"redeeming" | "done" | "failed">("redeeming");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("failed");
      return;
    }
    fetch("/api/v1/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok) {
          setState("failed");
          return;
        }
        const session = (await response.json()) as StoredSession;
        writeSession(session);
        setState("done");
        router.replace("/widget/frame");
      })
      .catch(() => setState("failed"));
  }, [router]);

  return (
    <main className={styles.returnShell}>
      {state === "redeeming" ? (
        <p className={styles.emailNote}>Opening your conversation…</p>
      ) : state === "failed" ? (
        <>
          <h1 className={styles.returnTitle}>This link is no longer valid</h1>
          <p className={styles.emailNote}>
            Return links expire 24 hours after the email was sent and work
            once. Your previous conversation cannot be reopened from here.
          </p>
          <a className={styles.returnLink} href="/widget/frame">
            Start a new chat
          </a>
        </>
      ) : (
        <p className={styles.emailNote}>Conversation opened — taking you to the chat…</p>
      )}
    </main>
  );
}
