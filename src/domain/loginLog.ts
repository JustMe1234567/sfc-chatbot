import { randomUUID } from "node:crypto";
import type { AppDatabase, AppDatabaseTx } from "../db/appDatabase";
import { DEFAULT_LOGIN_RETENTION_DAYS, readLoginRetention } from "../settings";

/**
 * Observable dashboard sign-ins (ticket 81): every credential attempt at the
 * auth provider's sign-in path is logged, suspicious patterns are flagged as
 * each event is written, and hammering that names no live staff account
 * earns a temporary IP block. Everything here speaks the portable `?` SQL of
 * the AppDatabase surface, so SQLite and Postgres behave identically — the
 * auth provider and its test fake both call these functions.
 *
 * Flagging is detection only: a flagged event never blocks, sounds, or locks
 * anything. The IP block is the only active control, and it lives in its own
 * table so clearing the log can never release a block early — the one-hour
 * auto-expiry is the only release.
 */

/** Criterion (a)/(c) evaluation window, and the block counting window. */
export const LOGIN_FLAG_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_BLOCK_WINDOW_MS = 10 * 60 * 1000;

/** (a) ≥5 failed attempts against one valid username from one IP in 10 minutes. */
export const LOGIN_FLAG_VALID_FAILURES = 5;
/** (c) ≥3 failed attempts against unknown or disabled usernames from one IP in 10 minutes. */
export const LOGIN_FLAG_UNKNOWN_FAILURES = 3;
/** The 10th non-staff-username failure from one IP in 10 minutes blocks it. */
export const LOGIN_BLOCK_FAILURES = 10;
/** The block lasts one hour from the triggering failure; it never extends. */
export const LOGIN_BLOCK_DURATION_MS = 60 * 60 * 1000;

export type LoginOutcome = "success" | "failure" | "blocked";

export type LoginFailureReason =
  | "unknown_username"
  | "disabled_account"
  | "invalid_password"
  | "ip_blocked";

export interface LoginEvent {
  id: string;
  username: string;
  outcome: LoginOutcome;
  reason: string;
  ip: string;
  userAgent: string | null;
  suspicious: boolean;
  createdAt: string;
}

interface LoginEventRow {
  id: string;
  username: string;
  outcome: string;
  reason: string;
  ip: string;
  userAgent: string | null;
  suspicious: number;
  createdAt: string;
}

function rowToEvent(row: LoginEventRow): LoginEvent {
  return {
    id: row.id,
    username: row.username,
    outcome: row.outcome as LoginOutcome,
    reason: row.reason,
    ip: row.ip,
    userAgent: row.userAgent,
    suspicious: row.suspicious === 1,
    createdAt: row.createdAt,
  };
}

/** What the provider knows about one attempt when it hands it over. */
export interface LoginEventInput {
  /** The attempted username, lowercased as the credential path reads it. */
  username: string;
  /** The ticket-20 trusted-header client key. */
  ip: string;
  userAgent: string | null;
}

/** The full row a writer hands over, including the staff-username
    classification the criteria pivot on. */
type InsertableLoginEvent = LoginEventInput & {
  outcome: LoginOutcome;
  reason: string;
  suspicious: boolean;
  usernameIsStaff: boolean;
};

async function insertEvent(
  db: AppDatabaseTx,
  event: InsertableLoginEvent,
  createdAt: string,
): Promise<void> {
  await db.run(
    `INSERT INTO login_events
       (id, username, outcome, reason, ip, user_agent, username_known, suspicious, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    event.username,
    event.outcome,
    event.reason,
    event.ip,
    event.userAgent,
    event.usernameIsStaff ? 1 : 0,
    event.suspicious ? 1 : 0,
    createdAt,
  );
}

/**
 * Whether the IP's one-hour block is in force right now. An expired row is
 * inert — the timestamp is the only release, and no code path deletes or
 * extends it.
 */
export async function isIpBlocked(
  db: AppDatabase,
  ip: string,
  now: number = Date.now(),
): Promise<boolean> {
  const row = await db.get<{ blockedUntil: string }>(
    `SELECT blocked_until AS "blockedUntil" FROM login_ip_blocks WHERE ip = ?`,
    ip,
  );
  return row !== undefined && row.blockedUntil > new Date(now).toISOString();
}

/**
 * Records one successful sign-in. Criterion (b): a success from an IP this
 * username has never successfully signed in from before is flagged — the
 * baseline is the prior successful events themselves, so owners clearing
 * logs reset it (accepted at grilling).
 */
export async function recordLoginSuccess(
  db: AppDatabase,
  input: LoginEventInput,
  now: number = Date.now(),
): Promise<{ suspicious: boolean }> {
  const createdAt = new Date(now).toISOString();
  const prior = await db.get<{ id: string }>(
    `SELECT id FROM login_events
     WHERE username = ? AND outcome = 'success' AND ip = ? LIMIT 1`,
    input.username,
    input.ip,
  );
  const suspicious = !prior;
  await insertEvent(
    db,
    { ...input, outcome: "success", reason: "", suspicious, usernameIsStaff: true },
    createdAt,
  );
  return { suspicious };
}

export interface LoginFailureInput extends LoginEventInput {
  /** Why the attempt failed, as the credential path classified it. */
  reason: LoginFailureReason;
  /**
   * Whether the attempted username belongs to a live staff account — the
   * classification the block rule and criteria (a)/(c) pivot on. A failure
   * against a valid username is criterion (a) territory and never counts
   * toward a block; unknown or disabled usernames feed (c) and the block.
   */
  usernameIsStaff: boolean;
}

/**
 * Records one failed sign-in attempt and evaluates the failure criteria as
 * the event is written. When the tenth non-staff-username failure from one
 * IP lands inside the rolling ten-minute window, the IP is blocked for one
 * hour — the triggering failure itself is logged as an ordinary failure,
 * and only attempts arriving after it are rejected as blocked.
 *
 * The whole evaluation is one transaction keyed on the client IP (ticket 81
 * amendment): concurrent failures count one another, so neither the block
 * boundary nor a suspicious boundary can be passed unnoticed — bare
 * count-then-write would let every concurrent attempt read the same prior
 * total and miss. The key covers the valid-username criterion (a) too;
 * those decisions share the IP's queue and stay exact.
 */
export async function recordLoginFailure(
  db: AppDatabase,
  input: LoginFailureInput,
  now: number = Date.now(),
): Promise<{ suspicious: boolean; blocked: boolean }> {
  const createdAt = new Date(now).toISOString();
  return db.transaction(`login-ip:${input.ip}`, async (tx) => {
    let suspicious = false;
    let blocked = false;
    if (input.usernameIsStaff) {
      // (a): the 5th and later failures against one valid username from one
      // IP inside the window carry the flag.
      const prior = await tx.get<{ hits: number }>(
        `SELECT COUNT(*) AS hits FROM login_events
         WHERE username = ? AND ip = ? AND outcome = 'failure'
           AND username_known = 1 AND created_at >= ?`,
        input.username,
        input.ip,
        new Date(now - LOGIN_FLAG_WINDOW_MS).toISOString(),
      );
      suspicious = Number(prior?.hits ?? 0) + 1 >= LOGIN_FLAG_VALID_FAILURES;
    } else {
      // (c): the 3rd and later non-staff-username failures from one IP inside
      // the window carry the flag.
      const prior = await tx.get<{ hits: number }>(
        `SELECT COUNT(*) AS hits FROM login_events
         WHERE ip = ? AND outcome = 'failure' AND username_known = 0 AND created_at >= ?`,
        input.ip,
        new Date(now - LOGIN_FLAG_WINDOW_MS).toISOString(),
      );
      suspicious = Number(prior?.hits ?? 0) + 1 >= LOGIN_FLAG_UNKNOWN_FAILURES;
      // The block rule: the same population, its own window and threshold.
      const counted = await tx.get<{ hits: number }>(
        `SELECT COUNT(*) AS hits FROM login_events
         WHERE ip = ? AND outcome = 'failure' AND username_known = 0 AND created_at >= ?`,
        input.ip,
        new Date(now - LOGIN_BLOCK_WINDOW_MS).toISOString(),
      );
      blocked = Number(counted?.hits ?? 0) + 1 >= LOGIN_BLOCK_FAILURES;
    }
    await insertEvent(
      tx,
      {
        username: input.username,
        ip: input.ip,
        userAgent: input.userAgent,
        outcome: "failure",
        reason: input.reason,
        suspicious,
        usernameIsStaff: input.usernameIsStaff,
      },
      createdAt,
    );
    if (blocked) {
      await tx.run(
        `INSERT INTO login_ip_blocks (ip, blocked_until, created_at) VALUES (?, ?, ?)
         ON CONFLICT (ip) DO UPDATE SET blocked_until = excluded.blocked_until`,
        input.ip,
        new Date(now + LOGIN_BLOCK_DURATION_MS).toISOString(),
        createdAt,
      );
    }
    return { suspicious, blocked };
  });
}

/**
 * Records one attempt rejected by an active IP block. These events are the
 * owner's evidence of the block working; they never extend the block and
 * never feed the failure counters, so sustained hammering during a block
 * cannot turn the one-hour expiry into a rolling one.
 */
export async function recordBlockedLoginAttempt(
  db: AppDatabase,
  input: LoginEventInput,
  now: number = Date.now(),
): Promise<void> {
  await insertEvent(
    db,
    { ...input, outcome: "blocked", reason: "ip_blocked", suspicious: false, usernameIsStaff: false },
    new Date(now).toISOString(),
  );
}

/**
 * One view of the log, newest first: the complete attempt log by default,
 * or the flagged subset for the Suspicious logs view. No page cap — the
 * spec's complete log — because the retention period bounds the table.
 */
export async function listLoginEvents(
  db: AppDatabase,
  options: { suspiciousOnly?: boolean } = {},
): Promise<LoginEvent[]> {
  const rows = await db.all<LoginEventRow>(
    `SELECT id, username, outcome, reason, ip, user_agent AS "userAgent",
            suspicious, created_at AS "createdAt"
     FROM login_events ${options.suspiciousOnly ? "WHERE suspicious = 1" : ""}
     ORDER BY created_at DESC, id DESC`,
  );
  return rows.map(rowToEvent);
}

/** Deletes the given entries; returns how many rows went away. */
export async function deleteLoginEvents(db: AppDatabase, ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.run(`DELETE FROM login_events WHERE id IN (${placeholders})`, ...ids);
  return result.changes;
}

/** Deletes every entry; returns how many rows went away. */
export async function clearLoginEvents(db: AppDatabase): Promise<number> {
  return (await db.run("DELETE FROM login_events")).changes;
}

/**
 * Removes login events older than the owner's retention period (default 90
 * days), mirroring the transcript sweep: a corrupt stored value refuses to
 * delete anything and returns null — retention must never act on a bad
 * value. Runs in the daily maintenance pass and on an immediate save.
 */
export async function sweepLoginEvents(
  db: AppDatabase,
  now: number = Date.now(),
): Promise<number | null> {
  const setting = await readLoginRetention(db);
  if (setting.kind === "invalid") {
    console.error(
      "login retention setting is not a valid period; sweep skipped:",
      setting.raw.slice(0, 64),
    );
    return null;
  }
  const days = setting.kind === "set" ? setting.days : DEFAULT_LOGIN_RETENTION_DAYS;
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  return (await db.run("DELETE FROM login_events WHERE created_at < ?", cutoff)).changes;
}
