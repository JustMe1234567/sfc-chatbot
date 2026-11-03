import styles from "./dashboard.module.css";

/**
 * The dashboard segment's instant loading state (ticket 42): a quiet shell in
 * the finished page's own chrome while a route streams in, so navigation
 * never lands on a blank frame.
 */
export default function DashboardLoading() {
  return (
    <main className={styles.shell}>
      <p className={styles.empty} role="status">
        Loading…
      </p>
    </main>
  );
}
