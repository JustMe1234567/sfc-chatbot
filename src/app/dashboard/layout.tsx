import type { Metadata } from "next";

/**
 * Dashboard document titles (ticket 29): every route names itself through
 * the template — "Inbox · Springfield College chat" and so on — via a
 * metadata export on the page (or its segment layout for the client
 * pages). A pass-through layout is the one place the template can live;
 * it adds no markup of its own.
 */
export const metadata: Metadata = {
  title: {
    default: "Springfield College chat",
    template: "%s · Springfield College chat",
  },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
