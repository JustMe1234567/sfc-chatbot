import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { trustedOrigins } from "../config";
import { publicClientKey } from "../api/clientKey";
import {
  isIpBlocked,
  recordBlockedLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess,
} from "../domain/loginLog";
import type { AuthDependencies, AuthIdentity, AuthProvider } from "./provider";

export interface SupabaseConfiguration {
  url: string;
  publishableKey: string;
  secretKey: string;
  databaseUrl: string;
}

function required(name: keyof NodeJS.ProcessEnv): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured for Supabase staff authentication.`);
  }
  return value;
}

function projectRefFromSupabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid hosted Supabase URL.");
  }
  const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (url.protocol !== "https:" || !match?.[1]) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must identify a hosted Supabase project over HTTPS.");
  }
  return match[1];
}

function projectRefFromDatabaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid Postgres connection string.");
  }
  const direct = url.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1];
  if (direct) return direct;
  const username = decodeURIComponent(url.username);
  return username.match(/^postgres\.([a-z0-9-]+)$/i)?.[1] ?? null;
}

export function supabaseConfiguration(): SupabaseConfiguration {
  const configuration = {
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: required("SUPABASE_SECRET_KEY"),
    databaseUrl: required("DATABASE_URL"),
  };
  const authProject = projectRefFromSupabaseUrl(configuration.url);
  const databaseProject = projectRefFromDatabaseUrl(configuration.databaseUrl);
  if (!databaseProject || databaseProject !== authProject) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and DATABASE_URL must identify the same Supabase project.",
    );
  }
  return configuration;
}

export function assertSupabaseConfigured(): void {
  supabaseConfiguration();
}

type CookieOptions = Parameters<typeof serializeCookieHeader>[2];
type PendingCookie = { name: string; value: string; options: CookieOptions };

interface StaffAuthRow {
  id: string;
  name: string;
  username: string;
  banned: unknown;
  emailVerified: unknown;
  supabaseUserId: string | null;
}

function enabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

function authError(message = "Unable to complete the authentication request.", status = 400): Response {
  return json({ error: { code: "authentication_failed", message } }, status);
}

function attachCookies(response: Response, cookies: PendingCookie[]): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  for (const cookie of cookies) {
    headers.append("Set-Cookie", serializeCookieHeader(cookie.name, cookie.value, cookie.options));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function mutationIsTrusted(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const allowed = trustedOrigins();
  const origin = request.headers.get("origin");
  if (origin) return allowed.includes(origin);
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return allowed.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

function requestClient(configuration: SupabaseConfiguration, headers: Headers) {
  const pending: PendingCookie[] = [];
  const client = createServerClient(configuration.url, configuration.publishableKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(headers.get("cookie") ?? "");
      },
      setAll(cookies) {
        pending.push(...cookies);
      },
    },
  });
  return { client, pending };
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) break;
  }
  return null;
}

export function createSupabaseAuth(dependencies: AuthDependencies): AuthProvider {
  const configuration = supabaseConfiguration();
  const admin = createClient(configuration.url, configuration.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  async function staffForUser(userId: string): Promise<StaffAuthRow | null> {
    return (
      (await dependencies.db.get<StaffAuthRow>(
        `SELECT "id", "name", "username", "banned", "emailVerified", "supabaseUserId"
         FROM staff_members WHERE "supabaseUserId" = ?`,
        userId,
      )) ?? null
    );
  }

  async function authenticate(headers: Headers): Promise<AuthIdentity | null> {
    const { client } = requestClient(configuration, headers);
    const { data: claimsData, error: claimsError } = await client.auth.getClaims();
    const claims = claimsData?.claims;
    if (claimsError || !claims?.session_id || !claims.sub) return null;

    // Claims prove the token; the live Auth rows prove that its session has
    // not been revoked and that the linked user and MFA factor remain valid.
    // Keeping this in one database round trip avoids an Auth network request
    // on every one-second inbox refresh while preserving immediate revocation.
    const currentSession = await dependencies.db.get<{
      email: string | null;
      emailConfirmedAt: string | null;
      mfaEnrolled: unknown;
    }>(
      `SELECT u.email,
              u.email_confirmed_at AS "emailConfirmedAt",
              EXISTS (
                SELECT 1 FROM auth.mfa_factors f
                WHERE f.user_id = u.id AND f.factor_type = 'totp' AND f.status = 'verified'
              ) AS "mfaEnrolled"
       FROM auth.sessions s
       JOIN auth.users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ?
         AND (s.not_after IS NULL OR s.not_after > CURRENT_TIMESTAMP)
         AND u.deleted_at IS NULL
         AND (u.banned_until IS NULL OR u.banned_until < CURRENT_TIMESTAMP)`,
      claims.session_id,
      claims.sub,
    );
    if (!currentSession) return null;
    return {
      userId: claims.sub,
      sessionId: claims.session_id,
      email: currentSession.email ?? "",
      emailVerified: Boolean(currentSession.emailConfirmedAt),
      aal: claims.aal === "aal2" ? "aal2" : "aal1",
      mfaEnrolled: enabled(currentSession.mfaEnrolled),
    };
  }

  async function handle(request: Request): Promise<Response> {
    if (!mutationIsTrusted(request)) {
      return json(
        { error: { code: "cross_origin_blocked", message: "Request origin is not allowed." } },
        403,
      );
    }
    const { client, pending } = requestClient(configuration, request.headers);
    const finish = (response: Response) => attachCookies(response, pending);
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\/?/, "");
    const body = request.method === "POST" ? await bodyOf(request) : null;

    if (request.method === "POST" && path === "sign-in/username") {
      const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (!username || !password) return finish(authError("Username and password are required."));
      // Ticket 81: every credential attempt is logged with the ticket-20
      // client identity and the browser's user agent.
      const ip = publicClientKey(request);
      const userAgent = request.headers.get("user-agent");
      const member = await dependencies.db.get<{ id: string; supabaseUserId: string | null; banned: unknown }>(
        `SELECT "id", "supabaseUserId", "banned" FROM staff_members WHERE lower("username") = lower(?)`,
        username,
      );
      // The classification the log's criteria pivot on: whether the
      // attempted username belongs to a live staff account. Unknown or
      // disabled names take the block path below; valid names never do.
      const usernameIsStaff = Boolean(member?.supabaseUserId) && !enabled(member?.banned);
      if (!usernameIsStaff && (await isIpBlocked(dependencies.db, ip))) {
        // While the IP is blocked, attempts that name no live staff account
        // are rejected outright and logged as blocked. The response is the
        // identical generic failure — a blocked attacker must not learn
        // which usernames are real from the status code.
        await recordBlockedLoginAttempt(dependencies.db, { username, ip, userAgent });
        return finish(authError("Username or password is incorrect.", 401));
      }
      if (!member?.supabaseUserId || enabled(member.banned)) {
        await recordLoginFailure(dependencies.db, {
          username,
          ip,
          userAgent,
          reason: member ? "disabled_account" : "unknown_username",
          usernameIsStaff: false,
        });
        return finish(authError("Username or password is incorrect.", 401));
      }
      const email = `${member.id}@staff.invalid`;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user || data.user.id !== member.supabaseUserId) {
        await recordLoginFailure(dependencies.db, {
          username,
          ip,
          userAgent,
          reason: "invalid_password",
          usernameIsStaff: true,
        });
        return finish(authError("Username or password is incorrect.", 401));
      }
      const staff = await staffForUser(data.user.id);
      if (!staff || enabled(staff.banned) || !enabled(staff.emailVerified)) {
        await client.auth.signOut({ scope: "global" });
        await recordLoginFailure(dependencies.db, {
          username,
          ip,
          userAgent,
          reason: "disabled_account",
          usernameIsStaff: true,
        });
        return finish(authError("Username or password is incorrect.", 401));
      }
      // The credential path succeeded — this is the attempt's outcome even
      // if the follow-up factor listing fails below.
      await recordLoginSuccess(dependencies.db, { username, ip, userAgent });
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) return finish(authError());
      return finish(
        json({
          twoFactorRedirect: factors.data.totp.some((factor) => factor.status === "verified"),
        }),
      );
    }

    if (request.method === "GET" && path === "get-session") {
      const identity = await authenticate(request.headers);
      if (!identity) return finish(json(null));
      const staff = await staffForUser(identity.userId);
      if (!staff || enabled(staff.banned)) return finish(json(null));
      return finish(
        json({
          user: {
            id: staff.id,
            username: staff.username,
            name: staff.name,
            twoFactorEnabled: identity.mfaEnrolled,
          },
          aal: identity.aal,
        }),
      );
    }

    if (request.method === "POST" && path === "two-factor/enable") {
      const identity = await authenticate(request.headers);
      const staff = identity ? await staffForUser(identity.userId) : null;
      if (!identity || !staff || enabled(staff.banned)) {
        return finish(authError("Sign in required.", 401));
      }
      const listed = await client.auth.mfa.listFactors();
      if (listed.error) return finish(authError());
      if (listed.data.all.some((factor) => factor.factor_type === "totp")) {
        return finish(authError("An authenticator is already enrolled.", 409));
      }
      const enrolled = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Springfield College chat",
        issuer: "Springfield College chat",
      });
      if (enrolled.error) return finish(authError(enrolled.error.message));
      return finish(
        json({
          totpURI: enrolled.data.totp.uri,
          qrCode: enrolled.data.totp.qr_code,
          factorId: enrolled.data.id,
        }),
      );
    }

    if (request.method === "POST" && path === "two-factor/verify-totp") {
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      const requestedFactor = typeof body?.factorId === "string" ? body.factorId : null;
      if (!/^\d{6}$/.test(code)) return finish(authError("Enter the six-digit authenticator code."));
      const identity = await authenticate(request.headers);
      const staff = identity ? await staffForUser(identity.userId) : null;
      if (!identity || !staff || enabled(staff.banned)) {
        return finish(authError("Sign in required.", 401));
      }
      const listed = await client.auth.mfa.listFactors();
      const factors = requestedFactor ? listed.data?.all : listed.data?.totp;
      const factor = factors?.find(
        (candidate) => candidate.factor_type === "totp" && (!requestedFactor || candidate.id === requestedFactor),
      );
      if (listed.error || !factor) return finish(authError("No authenticator is available."));
      const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verified.error) return finish(authError("The authenticator code is invalid.", 401));
      await dependencies.db.run(
        `UPDATE staff_members
         SET "twoFactorEnabled" = ?, "emailVerified" = ?, "mfaRecoveryApprovedAt" = NULL, "updatedAt" = ?
         WHERE "supabaseUserId" = ?`,
        true,
        true,
        new Date().toISOString(),
        identity.userId,
      );
      return finish(json({ success: true }));
    }

    if (request.method === "POST" && path === "sign-out") {
      const { error } = await client.auth.signOut({ scope: "local" });
      return finish(error ? authError() : json({ success: true }));
    }

    if (request.method === "POST" && path === "change-password") {
      const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
      if (newPassword.length < 10) return finish(authError("Password must be at least 10 characters."));
      const identity = await authenticate(request.headers);
      const staff = identity ? await staffForUser(identity.userId) : null;
      if (!identity || identity.aal !== "aal2" || !staff || enabled(staff.banned)) {
        return finish(authError("Verify your authenticator before changing the password.", 403));
      }
      const updated = await client.auth.updateUser({ password: newPassword });
      if (updated.error) return finish(authError(updated.error.message));
      await dependencies.db.run("DELETE FROM auth.sessions WHERE user_id = ?", identity.userId);
      return finish(json({ success: true }));
    }

    return finish(json({ error: { code: "not_found", message: "Authentication route not found." } }, 404));
  }

  return {
    authenticate,
    handle,
    async createAccount(staffId: string, name: string, password: string): Promise<{ userId: string }> {
      const email = `${staffId}@staff.invalid`;
      const existing = await findAuthUserByEmail(admin, email);
      if (existing) {
        return { userId: existing.id };
      }
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (created.error || !created.data.user) throw created.error ?? new Error("Account creation failed.");
      return { userId: created.data.user.id };
    },
    async resetPassword(userId: string, password: string): Promise<void> {
      const updated = await admin.auth.admin.updateUserById(userId, { password });
      if (updated.error) throw updated.error;
      await dependencies.db.run("DELETE FROM auth.sessions WHERE user_id = ?", userId);
    },
    async resetMfa(userId: string): Promise<void> {
      const listed = await admin.auth.admin.mfa.listFactors({ userId });
      if (listed.error) throw listed.error;
      for (const factor of listed.data.factors) {
        const removed = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
        if (removed.error) throw removed.error;
      }
      await dependencies.db.run("DELETE FROM auth.sessions WHERE user_id = ?", userId);
    },
    async revokeAll(userId: string): Promise<void> {
      await dependencies.db.run("DELETE FROM auth.sessions WHERE user_id = ?", userId);
    },
    async disable(userId: string): Promise<void> {
      const disabled = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (disabled.error) throw disabled.error;
      await dependencies.db.run("DELETE FROM auth.sessions WHERE user_id = ?", userId);
    },
  };
}
