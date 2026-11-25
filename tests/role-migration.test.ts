import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { audit, auditWithNames } from "../src/api/audit";
import { listStaffMembers } from "../src/api/staffMembers";
import { getChatbotService } from "../src/db/service";
import { registerFakeStaff } from "./fake-auth-provider";
import { CookieJar, signInAs } from "./auth-helpers";
import {
  ask,
  confirmHandoffYes,
  startConversation,
  testPostgresUrl,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";

/**
 * Ticket 102: Owner/Staff/Editor collapse into Admin and Admissions Advisor
 * through one data migration per dialect. This file drives the real migration
 * runners against accounts seeded with the three legacy values, so the
 * mapping — and the permission changes it carries — are observed as behavior
 * on both SQLite and Postgres, not read off the SQL.
 */

type LegacyRole = "owner" | "staff" | "editor";

const ROLE_MIGRATION = testPostgresUrl()
  ? "0013_admin_and_advisor_roles.sql"
  : "0023_admin_and_advisor_roles.sql";

const LEGACY_ROLES: LegacyRole[] = ["owner", "staff", "editor"];

interface LegacyAccount {
  role: LegacyRole;
  userId: string;
  username: string;
  name: string;
  password: string;
}

const PASSWORD = "legacy-password-42";

const ACCOUNTS: Record<LegacyRole, LegacyAccount> = {
  owner: {
    role: "owner",
    userId: "",
    username: "legacy-owner",
    name: "Legacy Owner",
    password: PASSWORD,
  },
  staff: {
    role: "staff",
    userId: "",
    username: "legacy-desk",
    name: "Legacy Desk",
    password: PASSWORD,
  },
  editor: {
    role: "editor",
    userId: "",
    username: "legacy-editor",
    name: "Legacy Editor",
    password: PASSWORD,
  },
};

/** One staff API request carrying `jar`'s session cookie, the way the dashboard sends it. */
function sessionRequest(jar: CookieJar, probe: { method: string; path: string; body?: string }): Request {
  return new Request(`${TEST_ORIGIN}${probe.path}`, {
    method: probe.method,
    headers: {
      cookie: jar.header(),
      // Unsafe methods pass the dashboard's cross-site guard with the app's own origin.
      ...(probe.method === "GET" ? {} : { origin: TEST_ORIGIN }),
      ...(probe.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(probe.body !== undefined ? { body: probe.body } : {}),
  });
}

/**
 * Each entry narrows a route module to the one handler the probes below
 * drive, so a missing handler fails the typecheck instead of the run.
 */
type Handler = (request: Request) => Promise<Response>;
const ROUTES: Record<string, () => Promise<{ GET?: Handler; POST?: Handler; PUT?: Handler }>> = {
  "/api/staff/analytics": () => import("../src/app/api/staff/analytics/route"),
  "/api/staff/conversations": () => import("../src/app/api/staff/conversations/route"),
  "/api/staff/conversations/clear-history": () =>
    import("../src/app/api/staff/conversations/clear-history/route"),
  "/api/staff/members": () => import("../src/app/api/staff/members/route"),
  "/api/staff/answer-rules": () => import("../src/app/api/staff/answer-rules/route"),
  "/api/staff/settings/welcome": () => import("../src/app/api/staff/settings/welcome/route"),
  "/api/staff/settings/support-hours": () =>
    import("../src/app/api/staff/settings/support-hours/route"),
  "/api/staff/settings/branding/chathead": () =>
    import("../src/app/api/staff/settings/branding/chathead/route"),
  "/api/staff/logs": () => import("../src/app/api/staff/logs/route"),
};

interface Probe {
  name: string;
  method: "GET" | "POST" | "PUT";
  path: keyof typeof ROUTES;
  body?: string;
  /** The confirmed matrix, keyed by the account's role before the migration. */
  status: Record<LegacyRole, number>;
}

/**
 * Every dashboard area's API, with the status each migrated account must
 * get. Owner→Admin keeps everything. Staff→Admissions Advisor keeps the
 * desk, gains answer editing, and loses analytics, the roster, configuration,
 * branding, and bulk history. Editor→Admissions Advisor keeps answer editing,
 * gains the desk, and loses configuration and branding.
 */
const PROBES: Probe[] = [
  { name: "analytics report", method: "GET", path: "/api/staff/analytics", status: { owner: 200, staff: 403, editor: 403 } },
  { name: "conversation list", method: "GET", path: "/api/staff/conversations", status: { owner: 200, staff: 200, editor: 200 } },
  { name: "staff roster", method: "GET", path: "/api/staff/members", status: { owner: 200, staff: 403, editor: 403 } },
  { name: "answer rules list", method: "GET", path: "/api/staff/answer-rules", status: { owner: 200, staff: 200, editor: 200 } },
  {
    name: "answer rule create",
    method: "POST",
    path: "/api/staff/answer-rules",
    body: JSON.stringify({ topic: "Migration", response: "The migrated account can edit.", phrases: ["migration probe phrase"] }),
    status: { owner: 201, staff: 201, editor: 201 },
  },
  { name: "welcome message read", method: "GET", path: "/api/staff/settings/welcome", status: { owner: 200, staff: 200, editor: 200 } },
  {
    name: "welcome message save",
    method: "PUT",
    path: "/api/staff/settings/welcome",
    body: JSON.stringify({ text: "Hello from the migrated account." }),
    status: { owner: 200, staff: 200, editor: 200 },
  },
  { name: "support hours read", method: "GET", path: "/api/staff/settings/support-hours", status: { owner: 200, staff: 403, editor: 403 } },
  { name: "login log", method: "GET", path: "/api/staff/logs", status: { owner: 200, staff: 403, editor: 403 } },
  {
    name: "branding save",
    method: "PUT",
    path: "/api/staff/settings/branding/chathead",
    body: "null",
    status: { owner: 200, staff: 403, editor: 403 },
  },
  { name: "clear history", method: "POST", path: "/api/staff/conversations/clear-history", status: { owner: 200, staff: 403, editor: 403 } },
];

/** A staff_members row written with a pre-migration role value and its Auth twin registered. */
async function seedLegacyMember(input: {
  username: string;
  name: string;
  role: string;
  password: string;
  banned?: boolean;
}): Promise<string> {
  const { db } = await getChatbotService();
  const userId = randomUUID();
  const authUserId = randomUUID();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO staff_members
     ("id", "name", "email", "username", "emailVerified", "createdAt", "updatedAt", "role",
      "banned", "supabaseUserId", "invitationStatus")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    input.name,
    `${userId}@staff.invalid`,
    input.username,
    true,
    now,
    now,
    input.role,
    input.banned ?? false,
    authUserId,
    "accepted",
  );
  registerFakeStaff({
    userId: authUserId,
    username: input.username,
    name: input.name,
    password: input.password,
  });
  return userId;
}

/**
 * Rewinds only the role migration — its tracking row goes, the legacy role
 * values are already in place — and replays the database's real migration
 * runner, which applies exactly the pending file.
 */
async function replayRoleMigration(): Promise<void> {
  const { db } = await getChatbotService();
  await db.run("DELETE FROM _migrations WHERE name = ?", ROLE_MIGRATION);
  if (testPostgresUrl()) {
    const { migratePostgres, openPostgres } = await import("../src/db/postgres");
    const sql = openPostgres(process.env.DATABASE_URL!);
    try {
      await migratePostgres(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  const { openDatabase } = await import("../src/db/sqlite");
  openDatabase(process.env.CHATBOT_DB!).close();
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
});

describe("the Admin / Admissions Advisor role migration (ticket 102)", () => {
  test("maps every legacy account and changes exactly the permissions the ticket confirms", async () => {
    for (const role of LEGACY_ROLES) {
      const account = ACCOUNTS[role];
      account.userId = await seedLegacyMember(account);
    }
    const bannedUserId = await seedLegacyMember({
      username: "legacy-banned",
      name: "Legacy Banned",
      role: "editor",
      password: PASSWORD,
      banned: true,
    });
    const { db, store } = await getChatbotService();

    // Sessions opened before the deployment must carry straight across it.
    const sessions = {} as Record<LegacyRole, CookieJar>;
    for (const role of LEGACY_ROLES) {
      const jar = new CookieJar();
      await signInAs(jar, ACCOUNTS[role].username, PASSWORD);
      sessions[role] = jar;
    }
    // A desk assignment and its audit attribution, made under the old roles.
    const conversation = await startConversation();
    await ask(conversation, "Where is the registrar? Please speak to a human.");
    await confirmHandoffYes(conversation);
    const deskUserId = ACCOUNTS.staff.userId;
    expect(await store.claimConversation(conversation.id, deskUserId)).not.toBeNull();
    await audit(store, deskUserId, "conversation_claimed", { conversationId: conversation.id });

    const before = await listStaffMembers(db);
    await replayRoleMigration();

    // The mapping: owner → admin; staff and editor → admissions_advisor.
    const after = await listStaffMembers(db);
    const roleOf = (rows: Awaited<ReturnType<typeof listStaffMembers>>, userId: string) =>
      rows.find((member) => member.id === userId)?.role;
    expect(roleOf(after, ACCOUNTS.owner.userId)).toBe("admin");
    expect(roleOf(after, ACCOUNTS.staff.userId)).toBe("admissions_advisor");
    expect(roleOf(after, ACCOUNTS.editor.userId)).toBe("admissions_advisor");
    expect(roleOf(after, bannedUserId)).toBe("admissions_advisor");

    // Exactly the two roles, and exactly one Admin — the account that was the owner.
    const storedRoles = await db.all<{ role: string }>(`SELECT DISTINCT "role" FROM staff_members`);
    expect([...storedRoles.map((row) => row.role)].sort()).toEqual(["admin", "admissions_advisor"]);
    expect(after.filter((member) => member.role === "admin")).toHaveLength(1);

    // Nothing else about an account moves: identity, linkage, and status are
    // the same rows with the same values.
    expect(after.map(({ role: _role, ...member }) => member)).toEqual(
      before.map(({ role: _role, ...member }) => member),
    );

    // The assignment and its attribution survive on the same staff id.
    expect((await store.getConversation(conversation.id))?.claimedBy).toBe(deskUserId);
    const trail = await auditWithNames(db, await store.listConversationAudit(conversation.id));
    expect(trail.find((entry) => entry.action === "conversation_claimed")?.actorName).toBe(
      ACCOUNTS.staff.name,
    );

    // The pre-deployment sessions still work, each with its migrated role's reach.
    for (const role of LEGACY_ROLES) {
      for (const probe of PROBES) {
        const module = ROUTES[probe.path];
        if (!module) throw new Error(`no probe module for ${probe.path}`);
        const handler = (await module())[probe.method];
        if (!handler) throw new Error(`no ${probe.method} handler for ${probe.path}`);
        const response = await handler(sessionRequest(sessions[role], probe));
        expect(response.status, `${probe.name} · legacy ${role}`).toBe(probe.status[role]);
      }
    }

    // A disabled account is still disabled after the migration.
    const bannedJar = new CookieJar();
    await expect(signInAs(bannedJar, "legacy-banned", PASSWORD)).rejects.toThrow(/sign-in failed: 401/);

    // Replaying the runner again changes nothing: the migration is tracked.
    await replayRoleMigrationRollForward();
    expect(await listStaffMembers(db)).toEqual(after);
  });
});

/** Runs the migration runner with nothing pending — the deployment's second boot. */
async function replayRoleMigrationRollForward(): Promise<void> {
  if (testPostgresUrl()) {
    const { migratePostgres, openPostgres } = await import("../src/db/postgres");
    const sql = openPostgres(process.env.DATABASE_URL!);
    try {
      await migratePostgres(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  const { openDatabase } = await import("../src/db/sqlite");
  openDatabase(process.env.CHATBOT_DB!).close();
}
