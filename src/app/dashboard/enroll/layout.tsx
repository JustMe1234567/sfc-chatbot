import type { Metadata } from "next";

/** The enrollment page is a client component, so its segment layout
 * carries the document title (ticket 29). */
export const metadata: Metadata = { title: "Second-factor setup" };

export default function EnrollLayout({ children }: { children: React.ReactNode }) {
  return children;
}
