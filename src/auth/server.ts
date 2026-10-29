import { Kysely, type Dialect } from "kysely";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { betterAuth } from "better-auth";
import { admin, createAccessControl, twoFactor } from "better-auth/plugins";
import { trustedOrigins } from "../config";
import type { AppDatabase } from "../db/appDatabase";
import type { MailTransport } from "../mail/outbox";

export type StaffRole = "owner" | "staff" | "editor";

export const STAFF_ROLES: readonly StaffRole[] = ["owner", "staff"];
export const DASHBOARD_ROLES: readonly StaffRole[] = ["owner", "staff", "editor"];
/** Roles holding answer-rules permissions in the access control above. */
export const ANSWER_RULE_ROLES: readonly StaffRole[] = ["owner", "editor"];

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
  db: AppDatabase;
  /** Kysely dialect for the active backend (SQLite node:sqlite or Postgres). */
  dialect: Dialect;
  /** Better Auth's Kysely database type: "sqlite" or "postgres". */
  kyselyType: "sqlite" | "postgres";
  mail: MailTransport;
  baseUrl: string;
}

/**
 * Staff authentication. Invite-only (no public sign-up route is ever exposed),
 * email+password with required email verification and TOTP second factor,
 * sessions and accounts stored in the same database as the chat data — SQLite
 * in development, Supabase Postgres in production (ticket 11). Secrets come
 * from server environment settings (BETTER_AUTH_SECRET), never from client
 * code; rotating the secret invalidates enrolled TOTP secrets, so it stays
 * fixed per environment.
 */
export function createAuth({ db, dialect, kyselyType, mail, baseUrl }: AuthDeps) {
  const kysely = new Kysely({ dialect });

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }

  return betterAuth({
    appName: "Springfield College chat",
    baseURL: baseUrl,
    secret: secret ?? "dev-only-secret-7c1f4a2e9b8d4f6a0e3c5b7d9f1a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6",
    database: { db: kysely, type: kyselyType },
    trustedOrigins: trustedOrigins(),
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
          subject: "Reset your Springfield College chat password",
          body: `A password reset was requested for your staff account. Open ${url} to choose a new password. The link expires shortly and can be used once. If you did not request this, ignore this email.`,
        });
      },
      // A completed reset signs the account out everywhere, including the
      // requester, so a stolen session cannot survive a password rotation.
      onPasswordReset: async ({ user }) => {
        await db.run('DELETE FROM "session" WHERE "userId" = ?', user.id);
      },
    },
    emailVerification: {
      // Staff accounts are provisioned verified server-side; there is no
      // public sign-up, so verification mail never applies in this release.
      sendOnSignUp: false,
      sendVerificationEmail: async ({ user, url }) => {
        await mail.send({
          to: user.email,
          subject: "Verify your Springfield College chat account",
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
        issuer: "Springfield College chat",
        skipVerificationOnEnable: false,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
