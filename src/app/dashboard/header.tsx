"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import SignOutButton from "./inbox/sign-out-button";
import styles from "./dashboard.module.css";

export type HeaderArea = "inbox" | "emails" | "answers" | "staff" | "alerts" | "analytics";

const NAV: { area: HeaderArea; href: string; label: string; roles: string[] }[] = [
  { area: "inbox", href: "/dashboard/inbox", label: "Conversations", roles: ["owner", "staff"] },
  // Ticket 53 amends the shared NAV list (ticket 52 froze its five entries):
  // Visitor emails joins beside Conversations, for the roles that work handoffs.
  { area: "emails", href: "/dashboard/emails", label: "Visitor emails", roles: ["owner", "staff"] },
  { area: "analytics", href: "/dashboard/analytics", label: "Analytics", roles: ["owner", "staff"] },
  { area: "answers", href: "/dashboard/answers", label: "Answers", roles: ["owner", "editor"] },
  { area: "staff", href: "/dashboard/staff", label: "Staff", roles: ["owner"] },
  { area: "alerts", href: "/dashboard/notifications", label: "Email alerts", roles: ["owner", "staff"] },
];

/**
 * The shared dashboard chrome (ticket 13, sidebar shell from ticket 52,
 * compact icon rail and one-at-a-time hover callouts from ticket 57).
 * Links respect the caller's role exactly as the per-page headers did —
 * editors see only Answers, staff see Conversations and Email alerts,
 * owners see everything.
 */
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  staff: "Staff",
  editor: "Editor",
};

/**
 * Hand-authored marks on one 24-grid, stroke-only so every icon inherits
 * the row's color (ticket 52): no icon library, no fixed fills. The shared
 * wrapper keeps the per-area entries to their paths alone.
 */
function Mark({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.sideIcon}
    >
      {children}
    </svg>
  );
}

const ICONS: Record<HeaderArea, ReactNode> = {
  inbox: (
    <Mark>
      <path d="M4 5.5h9.5V14H8.8L4 17.5z" />
      <path d="M16.5 9H20v5.5h-1.3L16 16.7V14h-2.5" />
    </Mark>
  ),
  emails: (
    <Mark>
      <rect x="3.5" y="6" width="17" height="12.5" rx="1.5" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </Mark>
  ),
  analytics: (
    <Mark>
      <path d="M6 19v-6" />
      <path d="M12 19V6" />
      <path d="M18 19v-9" />
    </Mark>
  ),
  answers: (
    <Mark>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12.5h5" />
      <path d="M9.5 16h5" />
    </Mark>
  ),
  staff: (
    <Mark>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.5-3.5 2.8-5 5.5-5s5 1.5 5.5 5" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16.6 14.3c2.2.4 3.9 1.8 4.3 4.2" />
    </Mark>
  ),
  alerts: (
    <Mark>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 6 1.8 6.5 1.8 8H4.2c0-1.5 1.8-2 1.8-8z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Mark>
  ),
};

const SIGN_OUT_MARK = (
  <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" />
    <path d="M13 8l4 4-4 4" />
    <path d="M17 12H8" />
  </svg>
);

const COLLAPSED_KEY = "dashboard.sidebar.collapsed";

const CHEVRON = (
  <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 6 8.5 12l6 6" />
  </svg>
);

const MENU_MARK = (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

/**
 * The sidebar rail: brand, the role-filtered nav, and the identity pinned
 * at the bottom. `data-collapsed` shrinks it to an icon rail and turns on
 * the hover/focus tooltips; the width and labels animate through the
 * shared motion tokens, which reduce to instant under the OS preference.
 */
function SidebarChrome({
  area,
  name,
  role,
  collapsed,
  onToggle,
  onNavigate,
}: {
  area: HeaderArea;
  name: string;
  role: string;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const navItems = NAV.filter((item) => item.roles.includes(role));
  // The compact rail's one callout (ticket 57): hovering or focusing a row
  // shows only that row's label, anchored beside the rail. One state means
  // one callout — moving to another row replaces it, leaving dismisses it.
  const [callout, setCallout] = useState<{ label: string; top: number } | null>(null);
  useEffect(() => {
    // Expanding the rail hides the callout for good — labels are visible.
    setCallout(null);
  }, [collapsed]);
  function showCallout(target: HTMLElement, label: string) {
    if (!collapsed) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    // Keep the callout inside the viewport, including the first and last
    // rows (12px edge margin; 48px ≈ the callout's half-height plus the
    // same margin); the element is position:fixed, so no rail or nav scroll
    // clip can hide it.
    const top = Math.max(12, Math.min(mid, window.innerHeight - 48));
    setCallout({ label, top });
  }
  const calloutProps = (label: string) =>
    collapsed
      ? {
          onMouseEnter: (event: React.MouseEvent<HTMLElement>) =>
            showCallout(event.currentTarget, label),
          onMouseLeave: () => setCallout(null),
          onFocus: (event: React.FocusEvent<HTMLElement>) =>
            showCallout(event.currentTarget, label),
          onBlur: () => setCallout(null),
        }
      : {};
  return (
    <>
      <div className={styles.sideBrand}>
        <Image
          src="/brand/cropped-SFC-Final-Logo-Single.png"
          alt=""
          width={34}
          height={34}
          className={styles.brandMark}
        />
        <span className={styles.sideCollege}>Springfield College</span>
      </div>
      {onToggle ? (
        <button
          type="button"
          className={styles.sideToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {CHEVRON}
        </button>
      ) : null}
      <nav
        className={styles.sideNav}
        aria-label="Dashboard"
        // The nav scrolls internally on short viewports; a scroll under a
        // stationary pointer would leave the callout detached from its row,
        // so any scroll dismisses it.
        onScroll={() => setCallout(null)}
      >
        {navItems.map((item) => (
          <Link
            key={item.area}
            href={item.href}
            className={styles.sideItem}
            aria-current={item.area === area ? "page" : undefined}
            onClick={onNavigate}
            // The collapsed rail hides the visible label and the callout is
            // decorative, so the link carries its own accessible name.
            aria-label={item.label}
            {...calloutProps(item.label)}
          >
            {ICONS[item.area]}
            <span className={styles.sideLabel} aria-hidden="true">
              {item.label}
            </span>
          </Link>
        ))}
      </nav>
      <div className={styles.sideIdentity}>
        <span className={styles.whoText}>
          {name} · {ROLE_LABELS[role] ?? role}
        </span>
        <span className={styles.sideSignOutWrap} {...calloutProps("Sign out")}>
          <SignOutButton icon={SIGN_OUT_MARK} />
        </span>
      </div>
      {collapsed && callout ? (
        // Decorative duplication of the accessible name: aria-hidden keeps
        // it out of the accessibility tree, pointer-events keeps hover from
        // re-triggering, and position:fixed (with the clamped top) keeps it
        // clear of the rail, the page, and the viewport edges.
        <span
          className={styles.sideTip}
          data-open=""
          aria-hidden="true"
          style={{ top: callout.top }}
        >
          {callout.label}
        </span>
      ) : null}
    </>
  );
}

/**
 * One component, two shells: the desktop rail (which the ≤720px media query
 * hides) and — only while open — the mobile drawer over a scrim. The page
 * title moves to a content-area heading row beside the drawer control, so
 * pages keep rendering exactly `<DashboardHeader area title name role />`
 * and nothing else about their markup changes.
 */
export default function DashboardHeader({
  area,
  title,
  name,
  role,
}: {
  area: HeaderArea;
  title: string;
  name: string;
  role: string;
}) {
  // The desktop default is the compact icon rail (ticket 57): the server
  // render and the hydration pass agree on collapsed, so default staff see
  // no flash. A stored explicit preference re-expands after mount.
  const [collapsed, setCollapsed] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Restored after mount: only the exact "0" marker — written when a staff
    // member expands the rail — reads as expanded; missing, "1", or stale
    // junk stays on the compact default. (Ticket 52 stored "1" for collapsed;
    // under the new default that reading is unchanged for those staff.)
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === "0") {
        setCollapsed(false);
      }
    } catch {
      // Storage unavailable (private mode); stay compact.
    }
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    };
    document.addEventListener("keydown", onKey);
    drawerRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        // Persistence is best-effort; the toggle still works this session.
      }
      return !value;
    });
  }

  function closeDrawer() {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }

  return (
    <>
      <aside className={styles.sidebar} data-collapsed={collapsed || undefined}>
        <SidebarChrome
          area={area}
          name={name}
          role={role}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
        />
      </aside>

      {drawerOpen ? (
        <>
          <div className={styles.sideScrim} onClick={closeDrawer} />
          <aside
            ref={drawerRef}
            className={`${styles.sidebar} ${styles.sideDrawer}`}
            id="dashboard-drawer"
            aria-label="Dashboard menu"
          >
            <SidebarChrome
              area={area}
              name={name}
              role={role}
              collapsed={false}
              onNavigate={closeDrawer}
            />
          </aside>
        </>
      ) : null}

      <div className={styles.contentHead}>
        <button
          ref={menuButtonRef}
          type="button"
          className={styles.menuButton}
          aria-expanded={drawerOpen}
          aria-controls="dashboard-drawer"
          aria-label="Menu"
          onClick={() => setDrawerOpen(true)}
        >
          {MENU_MARK}
          <span className={styles.menuLabel}>Menu</span>
        </button>
        <h1 className={styles.contentTitle}>{title}</h1>
      </div>
    </>
  );
}
