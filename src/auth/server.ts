export type StaffRole = "owner" | "staff" | "editor";

/** Roles permitted to work in the shared inbox. */
export const STAFF_ROLES: readonly StaffRole[] = ["owner", "staff"];
/** Every role that may open at least one dashboard area. */
export const DASHBOARD_ROLES: readonly StaffRole[] = ["owner", "staff", "editor"];
/** Roles permitted to maintain and publish answer rules. */
export const ANSWER_RULE_ROLES: readonly StaffRole[] = ["owner", "editor"];
