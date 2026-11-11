import { headers } from "next/headers";
import type { Metadata } from "next";
import { getChatbotService } from "@/db/service";
import { getDashboardFaviconVersion } from "@/settings";

/**
 * Dashboard document titles (ticket 29): every route names itself through
 * the template — "Inbox · Springfield College chat" and so on — via a
 * metadata export on the page (or its segment layout for the client
 * pages). A pass-through layout is the one place the template can live;
 * it adds no markup of its own.
 */
const TITLE_METADATA: Metadata = {
  title: {
    default: "Springfield College chat",
    template: "%s · Springfield College chat",
  },
};

/**
 * The dashboard favicon (ticket 70): the configured asset (or the bundled
 * crest) served by the versioned branding route, so a save reaches the
 * browser tab on the next load without a redeploy. This layout wraps every
 * /dashboard segment — login and enrollment included — and only those; the
 * public demo and the widget keep their own favicon behavior.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Dynamic rendering: the favicon version is request-time state, and a
  // statically prerendered login page would bake the pre-save asset in
  // (found by the ticket 70 certification — the prerendered login page
  // served without the icon link entirely).
  await headers();
  try {
    const { db } = await getChatbotService();
    const version = await getDashboardFaviconVersion(db);
    return {
      ...TITLE_METADATA,
      icons: { icon: `/api/branding/dashboard-favicon?v=${encodeURIComponent(version)}` },
    };
  } catch {
    // The store is unreachable (e.g. a metadata evaluation without one);
    // titles still apply and the favicon falls back to the bundled asset's
    // default version rather than dropping the link entirely.
    return {
      ...TITLE_METADATA,
      icons: { icon: "/api/branding/dashboard-favicon?v=default" },
    };
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
