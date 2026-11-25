/**
 * The two dashboard roles (ticket 102). Admin reaches every area and action;
 * the Admissions Advisor works the conversation desk, the visitor contacts,
 * and the whole Answers area, and is refused Analytics, Settings, Logs, and
 * Staff accounts. These are the values stored in `staff_members.role`.
 */
export type StaffRole = "admin" | "admissions_advisor";

/** Roles permitted to work in the shared inbox. */
export const STAFF_ROLES: readonly StaffRole[] = ["admin", "admissions_advisor"];
/** Every role that may open at least one dashboard area. */
export const DASHBOARD_ROLES: readonly StaffRole[] = ["admin", "admissions_advisor"];
/** Roles permitted to maintain and publish answer rules. */
export const ANSWER_RULE_ROLES: readonly StaffRole[] = ["admin", "admissions_advisor"];

/** What each stored role is called in dashboard-facing copy. */
const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin",
  admissions_advisor: "Admissions Advisor",
};

/**
 * The dashboard-facing name of a stored role, so no surface prints the
 * stored value; an unrecognized value shows as stored.
 */
export function staffRoleLabel(role: string): string {
  return (STAFF_ROLE_LABELS as Record<string, string>)[role] ?? role;
}
