"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import SignOutButton from "./inbox/sign-out-button";
import PasswordDialog from "./password-dialog";
import {
  initialSidebarCollapsed,
  persistSidebarCollapsed,
  restoreSidebarCollapsed,
} from "./sidebar-preference";
import { createNeedsHumanSignal, NEEDS_HUMAN_POLL_MS } from "@/domain/needsHumanSignal";
import { staffRoleLabel } from "@/auth/server";
import styles from "./dashboard.module.css";

export type HeaderArea = "inbox" | "contacts" | "answers" | "staff" | "analytics" | "settings" | "logs";

/**
 * Each area with the roles that may open it (ticket 102): Admissions Advisors
 * work Conversations, Visitor contacts, and Answers; Analytics, Staff
 * accounts, Logs, and Settings are Admin areas. Every entry mirrors its
 * page's and APIs' `requireStaff` gate.
 */
const NAV: { area: HeaderArea; href: string; label: string; roles: string[] }[] = [
  { area: "inbox", href: "/dashboard/inbox", label: "Conversations", roles: ["admin", "admissions_advisor"] },
  // Ticket 53 added this entry; ticket 69 renames it — the saved-contact
  // list beside Conversations, for the roles that work follow-ups.
  { area: "contacts", href: "/dashboard/contacts", label: "Visitor contacts", roles: ["admin", "admissions_advisor"] },
  { area: "analytics", href: "/dashboard/analytics", label: "Analytics", roles: ["admin"] },
  { area: "answers", href: "/dashboard/answers", label: "Answers", roles: ["admin", "admissions_advisor"] },
  // Staff accounts (ticket 08): where Admins create and manage Admissions
  // Advisor accounts.
  { area: "staff", href: "/dashboard/staff", label: "Staff accounts", roles: ["admin"] },
  // Login observability (ticket 81): every dashboard sign-in attempt, its
  // suspicious flags, and the deletion controls — admins alone.
  { area: "logs", href: "/dashboard/logs", label: "Logs", roles: ["admin"] },
  // Settings (tickets 70 and 76): branding and the security-sensitive
  // configuration — admins alone.
  { area: "settings", href: "/dashboard/settings", label: "Settings", roles: ["admin"] },
];

// The Conversations row's own role list from the NAV table above: the
// needs-human bell's poll runs only for the roles that can see the row
// (ticket 79).
const CONVERSATIONS_ROLES =
  NAV.find((item) => item.area === "inbox")?.roles ?? [];

/**
 * The shared dashboard chrome (ticket 13, sidebar shell from ticket 52,
 * compact icon rail and one-at-a-time hover callouts from ticket 57).
 * Links respect the caller's role exactly as the per-page gates do —
 * Admissions Advisors see Conversations, Visitor contacts, and Answers,
 * while Admins see every area.
 */

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

/**
 * The needs-human bell (ticket 79): a small stroke bell hand-plotted into
 * the free top-right corner of the chat bubble — its lowest stroke clears
 * the smaller bubble's top edge — rendered inside the same SVG only while
 * the signal says a conversation is waiting, so the row's layout never
 * shifts and all three sidebar shells carry the identical mark. It wears
 * the Needs-human green, the bright graphic variant of the ticket-66 tier
 * color (the rail is dark; the pill's `--ok` would sink into it), and adds
 * no text, no count, and no announcement of its own: the row's accessible
 * name carries the words.
 */
const NEEDS_HUMAN_BELL = (
  <g className={styles.sideBellStroke}>
    <path d="M16.4 6.1C16.3 4.5 16.8 2.8 18 1.8C18.4 1.5 18.8 1.3 19.3 1.3C19.8 1.3 20.2 1.5 20.6 1.8C21.8 2.8 22.3 4.5 22.2 6.1L22.6 6.9L16 6.9Z" />
  </g>
);

/**
 * Hand-authored marks on one 24-grid, stroke-only so every icon inherits
 * the row's color (ticket 52): no icon library, no fixed fills. The shared
 * wrapper keeps the per-area entries to their paths alone. Each entry is
 * drawn per render; only the Conversations mark varies (ticket 79's
 * conditional bell), and a poll that changes nothing re-renders nothing.
 */
const ICONS: Record<HeaderArea, (needsHuman: boolean) => ReactNode> = {
  inbox: (needsHuman) => (
    <Mark>
      <path d="M4 5.5h9.5V14H8.8L4 17.5z" />
      <path d="M16.5 9H20v5.5h-1.3L16 16.7V14h-2.5" />
      {needsHuman ? NEEDS_HUMAN_BELL : null}
    </Mark>
  ),
  contacts: () => (
    <Mark>
      <rect x="3.5" y="6" width="17" height="12.5" rx="1.5" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </Mark>
  ),
  analytics: () => (
    <Mark>
      <path d="M6 19v-6" />
      <path d="M12 19V6" />
      <path d="M18 19v-9" />
    </Mark>
  ),
  answers: () => (
    <Mark>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12.5h5" />
      <path d="M9.5 16h5" />
    </Mark>
  ),
  staff: () => (
    <Mark>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.5-3.5 2.8-5 5.5-5s5 1.5 5.5 5" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16.6 14.3c2.2.4 3.9 1.8 4.3 4.2" />
    </Mark>
  ),
  settings: () => (
    // A conventional cog (ticket 72): one eight-tooth outline around a
    // centered circular opening, hand-plotted on the same 24-grid so the
    // shared Mark's stroke, size, and color treatment apply unchanged.
    <Mark>
      <path d="M20.5 10.5L20.5 13.5L18.2 13.8L17.6 15.1L19.0 16.9L16.9 19.0L15.1 17.6L13.8 18.2L13.5 20.5L10.5 20.5L10.2 18.2L8.9 17.6L7.1 19.0L5.0 16.9L6.4 15.1L5.8 13.8L3.5 13.5L3.5 10.5L5.8 10.2L6.4 8.9L5.0 7.1L7.1 5.0L8.9 6.4L10.2 5.8L10.5 3.5L13.5 3.5L13.8 5.8L15.1 6.4L16.9 5.0L19.0 7.1L17.6 8.9L18.2 10.2Z" />
      <circle cx="12" cy="12" r="3.1" />
    </Mark>
  ),
  logs: () => (
    // A hand-plotted scroll (ticket 81): two rolled ends with the unrolled
    // paper between them and one short line suggesting writing — the
    // sign-in record — on the same 24-grid as every other mark.
    <Mark>
      <rect x="3.5" y="4.5" width="4" height="15" rx="2" />
      <rect x="16.5" y="4.5" width="4" height="15" rx="2" />
      <path d="M7.5 7.5h9" />
      <path d="M7.5 16.5h9" />
      <path d="M10.5 12h3" />
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
 * Whether any live desk conversation sits in Needs human (ticket 79): the
 * dashboard-wide counterpart to the inbox desk's repeating alert (ticket
 * 77), so the bell is correct from every dashboard page — the sidebar
 * carries no desk data outside the inbox, and nothing re-renders it while
 * staff sit elsewhere, so even presence needs this one lightweight poll.
 * It polls every 10 seconds while the tab is visible, catches up the
 * moment a hidden tab returns (the AutoRefresh visibility pattern), keeps
 * its last state across a failed request, and runs only for the roles
 * that can see the Conversations row — editors poll nothing.
 */
function useNeedsHumanSignal(role: string): boolean {
  const [needsHuman, setNeedsHuman] = useState(false);
  useEffect(() => {
    if (!CONVERSATIONS_ROLES.includes(role)) {
      return;
    }
    const signal = createNeedsHumanSignal({
      fetchResponse: () => fetch("/api/v1/needs-human"),
      visible: () => document.visibilityState === "visible",
      adopt: setNeedsHuman,
    });
    // Correct immediately on each mount — every dashboard page renders the
    // header fresh — then on the cadence while visible.
    void signal.poll();
    const timer = setInterval(() => void signal.poll(), NEEDS_HUMAN_POLL_MS);
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        void signal.poll();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [role]);
  return needsHuman;
}

/**
 * What a Conversations row says to assistive technology and to the compact
 * rail's callout (ticket 79): the plain label, or the needs-human wording
 * while the bell shows. One wording, resolved at call time, so the row's
 * accessible name and the callout can never drift apart.
 */
function rowLabelFor(item: { area: HeaderArea; label: string }, needsHuman: boolean): string {
  return item.area === "inbox" && needsHuman ? `${item.label} — needs human` : item.label;
}

/**
 * The sidebar rail: brand, the expand/collapse control, the role-filtered
 * nav, and the identity pinned at the bottom (ticket 60 moved the control
 * to the top of the icon stack). `data-collapsed` shrinks it to an icon
 * rail and turns on the hover/focus tooltips; the width and labels animate
 * through the shared motion tokens, which reduce to instant under the OS
 * preference.
 */
function SidebarChrome({
  area,
  name,
  role,
  collapsed,
  needsHuman,
  onToggle,
  onNavigate,
}: {
  area: HeaderArea;
  name: string;
  role: string;
  collapsed: boolean;
  needsHuman: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const navItems = NAV.filter((item) => item.roles.includes(role));
  // The toggle's swapped name, computed once: the accessible label and the
  // compact rail's callout must never drift apart.
  const toggleLabel = collapsed ? "Expand navigation" : "Collapse navigation";
  // The compact rail's one callout (ticket 57): hovering or focusing a row
  // shows only that row's label, anchored beside the rail. One state means
  // one callout — moving to another row replaces it, leaving dismisses it.
  // The label is a string, or — for the Conversations row (ticket 79) — a
  // resolver, so a bell that appears or clears while the pointer rests
  // updates the displayed wording instead of leaving it stale.
  const [callout, setCallout] = useState<{ label: string | (() => string); top: number } | null>(
    null,
  );
  // The resolver must read the bell state as it is NOW, not as it was when
  // the pointer arrived — the closure captured at hover would otherwise go
  // stale the moment the state flips under a resting pointer.
  const needsHumanRef = useRef(needsHuman);
  needsHumanRef.current = needsHuman;
  useEffect(() => {
    // Expanding the rail hides the callout for good — labels are visible.
    setCallout(null);
  }, [collapsed]);
  function showCallout(target: HTMLElement, label: string | (() => string)) {
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
  const calloutProps = (label: string | (() => string)) =>
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
      {/* The reference's brand block (ticket 58): the crest alone, larger and
          centered over a thin divider — the rail's hierarchy is crest,
          navigation, Sign out. */}
      <div className={styles.sideBrand}>
        <Image
          src="/brand/cropped-SFC-Final-Logo-Single.png"
          alt=""
          width={44}
          height={44}
          className={styles.brandMark}
        />
      </div>
      {onToggle ? (
        // The expand/collapse control leads the icon stack (ticket 60,
        // superseding ticket 58's bottom slot): the first row under the
        // crest. Sitting among the icon-only rows, it joins ticket 57's
        // one-callout system — hover or focus names it like every other
        // mark in the compact rail.
        <button
          type="button"
          className={styles.sideToggle}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          onClick={onToggle}
          {...calloutProps(toggleLabel)}
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
        {navItems.map((item) => {
          // While the bell shows, the row says so to assistive technology
          // (ticket 79) — the visible label, the collapsed rail's callout,
          // and the accessible name stay one wording, and the bell itself
          // is aria-hidden inside the mark, so it is never announced. The
          // callout resolves the wording at display time, so a bell that
          // appears or clears under a resting pointer is never stale.
          const rowLabel = rowLabelFor(item, needsHuman);
          return (
            <Link
              key={item.area}
              href={item.href}
              // Automatic prefetch is off (ticket 99): every nav row is a
              // dynamic, database-backed route, and Next.js prefetches each
              // link as it enters the viewport — opening the dashboard fired
              // all rows' RSC renders at once, the fan-out that exhausted
              // the shared pooler's 15-client cap in production. Clicking a
              // row navigates exactly as before; the route renders on
              // navigation instead of ahead of it.
              prefetch={false}
              className={styles.sideItem}
              aria-current={item.area === area ? "page" : undefined}
              onClick={onNavigate}
              // The collapsed rail hides the visible label and the callout is
              // decorative, so the link carries its own accessible name.
              aria-label={rowLabel}
              {...calloutProps(() => rowLabelFor(item, needsHumanRef.current))}
            >
              {ICONS[item.area](needsHuman)}
              <span className={styles.sideLabel} aria-hidden="true">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <div className={styles.sideIdentity}>
        <span className={styles.whoText}>
          {name} · {staffRoleLabel(role)}
        </span>
        {/* The self-service password change (ticket 102): Settings became an
            Admin area, so both roles reach the change from the chrome. */}
        <PasswordDialog />
        <span className={styles.sideSignOutWrap} {...calloutProps("Sign out")}>
          <SignOutButton icon={SIGN_OUT_MARK} />
        </span>
      </div>
      {collapsed && callout ? (
        // Decorative duplication of the accessible name: aria-hidden keeps
        // it out of the accessibility tree, pointer-events keeps hover from
        // re-triggering, and position:fixed (with the clamped top) keeps it
        // clear of the rail, the page, and the viewport edges. A resolver
        // label re-reads the row's current wording on every render (ticket
        // 79), so a bell appearing or clearing under a resting pointer
        // updates the text in place.
        <span
          className={styles.sideTip}
          data-open=""
          aria-hidden="true"
          style={{ top: callout.top }}
        >
          {typeof callout.label === "function" ? callout.label() : callout.label}
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
  hideTitle = false,
}: {
  area: HeaderArea;
  title: string;
  name: string;
  role: string;
  /**
   * Renders the page title visually-hidden instead of in the heading row
   * (ticket 74): the Visitor contacts content carries the reference-style
   * title itself, and the accessible structure stays one h1 deep. Other
   * routes are unchanged.
   */
  hideTitle?: boolean;
}) {
  // The desktop default is the compact icon rail (ticket 57): the server
  // render and the hydration pass agree on collapsed, so default staff see
  // no flash. A stored explicit preference re-expands after mount.
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // One poll per page render (ticket 79): the desktop rail and the drawer
  // both read this state, so opening the drawer never doubles the requests.
  const needsHuman = useNeedsHumanSignal(role);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Restored after mount: only the exact "0" marker — written when a staff
    // member expands the rail — reads as expanded; missing, "1", or stale
    // junk stays on the compact default. (Ticket 52 stored "1" for collapsed;
    // under the new default that reading is unchanged for those staff.)
    try {
      setCollapsed(restoreSidebarCollapsed(window.localStorage));
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
      const next = !value;
      try {
        persistSidebarCollapsed(window.localStorage, next);
      } catch {
        // Persistence is best-effort; the toggle still works this session.
      }
      return next;
    });
  }

  function closeDrawer() {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }

  return (
    <>
      {/* First focusable element on every dashboard route (ticket 29): one
          Tab from the address bar jumps the rail straight to the content. */}
      <a href="#sfc-content" className={styles.skipLink}>
        Skip to content
      </a>
      <aside className={styles.sidebar} data-collapsed={collapsed || undefined}>
        <SidebarChrome
          area={area}
          name={name}
          role={role}
          collapsed={collapsed}
          needsHuman={needsHuman}
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
              needsHuman={needsHuman}
              onNavigate={closeDrawer}
            />
          </aside>
        </>
      ) : null}

      <div
        className={styles.contentHead}
        data-desk-heading={area === "inbox" || undefined}
      >
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
        <h1 className={hideTitle ? styles.srOnly : styles.contentTitle}>{title}</h1>
      </div>
    </>
  );
}
