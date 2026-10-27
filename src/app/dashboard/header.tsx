import Link from "next/link";
import Image from "next/image";
import SignOutButton from "./inbox/sign-out-button";
import styles from "./dashboard.module.css";

export type HeaderArea = "inbox" | "answers" | "staff" | "alerts";

const NAV: { area: HeaderArea; href: string; label: string; roles: string[] }[] = [
  { area: "inbox", href: "/dashboard/inbox", label: "Conversations", roles: ["owner", "staff"] },
  { area: "answers", href: "/dashboard/answers", label: "Answers", roles: ["owner", "editor"] },
  { area: "staff", href: "/dashboard/staff", label: "Staff", roles: ["owner"] },
  { area: "alerts", href: "/dashboard/notifications", label: "Email alerts", roles: ["owner", "staff"] },
];

/**
 * The shared dashboard chrome (ticket 13): Springfield College brand, one
 * navigation row, and the signed-in identity. Links respect the caller's
 * role exactly as the per-page headers did — editors see only Answers,
 * staff see Conversations and Email alerts, owners see everything.
 */
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  staff: "Staff",
  editor: "Editor",
};

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
  return (
    <header className={styles.topBar}>
      <div className={styles.brand}>
        <Image
          src="/brand/cropped-SFC-Final-Logo-Single.png"
          alt=""
          width={34}
          height={34}
          className={styles.brandMark}
        />
        <div className={styles.brandText}>
          <span className={styles.brandCollege}>Springfield College</span>
          <h1 className={styles.pageTitle}>{title}</h1>
        </div>
      </div>
      <nav className={styles.topNav} aria-label="Dashboard">
        {NAV.filter((item) => item.roles.includes(role)).map((item) => (
          <Link
            key={item.area}
            href={item.href}
            aria-current={item.area === area ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className={styles.topIdentity}>
        <span className={styles.whoText}>
          {name} · {ROLE_LABELS[role] ?? role}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
