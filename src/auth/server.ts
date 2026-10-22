import type { DatabaseSync } from "node:sqlite";
import { Kysely } from "kysely";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { betterAuth } from "better-auth";
import { admin, createAccessControl, twoFactor } from "better-auth/plugins";
import type { MailTransport } from "../mail/outbox";

export type StaffRole = "owner" | "staff" | "editor";

export const STAFF_ROLES: readonly StaffRole[] = ["owner", "staff"];
export const DASHBOARD_ROLES: readonly StaffRole[] = ["owner", "staff", "editor"];

/** Dashboard permission vocabulary: resources and the actions on them. */
const access = createAccessControl({
  inbox: ["read"],
  "answer-rules": ["read", "create", "update", "publish"],
  staff: ["read", "invite", "disable"],
  settings: ["read", "update"],
  // Admin-plugin capabilities the owner needs for staff administration.
  user: ["get", "list", "create", "ban", "set-password", "set-role", "delete"],
  session: ["list", "revoke"],
});

const roles = {
  owner: access.newRole({
    inbox: ["read"],
    "answer-rules": ["read", "create", "update", "publish"],
    staff: ["read", "invite", "disable"],
    settings: ["read", "update"],
    user: ["get", "list", "create", "ban", "set-password", "set-role", "delete"],
    session: ["list", "revoke"],
  }),
  staff: access.newRole({ inbox: ["read"] }),
  editor: access.newRole({
    "answer-rules": ["read", "create", "update", "publish"],
  }),
};

export interface AuthDeps {
  db: DatabaseSync;
  mail: MailTransport;
  baseUrl: string;
}

/**
 * Staff authentication. Invite-only (no public sign-up route is ever exposed),
 * email+password with required email verification and TOTP second factor,
 * sessions and accounts stored in the same SQLite database as the chat data so
 * ticket 11 can move both to Postgres together. Secrets come from server
 * environment settings (BETTER_AUTH_SECRET), never from client code.
 */
export function createAuth({ db, mail, baseUrl }: AuthDeps) {
  const kysely = new Kysely({ dialect: new NodeSqliteDialect({ database: db }) });
  // localhost and 127.0.0.1 are different origins to the browser; local
  // dashboard checks must work on either form of the loopback address.
  const devLoopbackOrigins =
    process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:3000", "http://127.0.0.1:3000"];

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }

  return betterAuth({
    appName: "Example College chat",
    baseURL: baseUrl,
    secret: secret ?? "dev-only-secret-7c1f4a2e9b8d4f6a0e3c5b7d9f1a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6",
    database: { db: kysely, type: "sqlite" },
    trustedOrigins: [baseUrl, ...devLoopbackOrigins],
    advanced: {
      // HttpOnly + SameSite are better-auth defaults; Secure cookies in
      // production (behind HTTPS) per the spec.
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    emailAndPassword: {
      enabled: true,
      // Staff accounts are invite-only: the owner provisions them server-side
      // (see src/auth/provision.ts and scripts/bootstrap-owner.ts).
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        await mail.send({
          to: user.email,
          subject: "Reset your Example College chat password",
          body: `A password reset was requested for your staff account. Open ${url} to choose a new password. The link expires shortly and can be used once. If you did not request this, ignore this email.`,
        });
      },
      // A completed reset signs the account out everywhere, including the
      // requester, so a stolen session cannot survive a password rotation.
      onPasswordReset: async ({ user }) => {
        db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(user.id);
      },
    },
    emailVerification: {
      // Staff accounts are provisioned verified server-side; there is no
      // public sign-up, so verification mail never applies in this release.
      sendOnSignUp: false,
      sendVerificationEmail: async ({ user, url }) => {
        await mail.send({
          to: user.email,
          subject: "Verify your Example College chat account",
          body: `Welcome, ${user.name}. Verify your staff account by opening ${url}.`,
        });
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { max: 10, window: 60 },
        "/forget-password": { max: 5, window: 60 },
        "/reset-password": { max: 10, window: 60 },
        "/two-factor/verify-totp": { max: 10, window: 60 },
      },
    },
    plugins: [
      admin({
        roles,
        adminRoles: ["owner"],
        defaultRole: "staff",
      }),
      twoFactor({
        issuer: "Example College chat",
        skipVerificationOnEnable: false,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
