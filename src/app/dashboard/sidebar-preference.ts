const COLLAPSED_KEY = "dashboard.sidebar.collapsed";

// Client-module state survives Next.js page-component replacements during
// route transitions. It starts empty so the first hydration stays compact
// and agrees with the server render; storage restoration then seeds every
// later DashboardHeader mount synchronously (ticket 64).
let sessionCollapsed: boolean | null = null;

export function initialSidebarCollapsed(): boolean {
  return sessionCollapsed ?? true;
}

export function restoreSidebarCollapsed(storage: Pick<Storage, "getItem">): boolean {
  const collapsed = storage.getItem(COLLAPSED_KEY) !== "0";
  sessionCollapsed = collapsed;
  return collapsed;
}

export function persistSidebarCollapsed(
  storage: Pick<Storage, "setItem">,
  collapsed: boolean,
): void {
  sessionCollapsed = collapsed;
  storage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
}
