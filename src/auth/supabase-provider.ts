import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { trustedOrigins } from "../config";
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
  email: string;
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
        `SELECT "id", "name", "email", "banned", "emailVerified", "supabaseUserId"
         FROM staff_members WHERE "supabaseUserId" = ?`,
        userId,
      )) ?? null
    );
  }

  async function authenticate(headers: Headers): Promise<AuthIdentity | null> {
    const { client } = requestClient(configuration, headers);
    const [{ data: userData, error: userError }, { data: claimsData, error: claimsError }] =
      await Promise.all([client.auth.getUser(), client.auth.getClaims()]);
    const user = userData.user;
    const claims = claimsData?.claims;
    if (userError || claimsError || !user || !claims?.session_id || claims.sub !== user.id) return null;

    // The Auth server may accept a signed access token until its short expiry.
    // Requiring its backing session row makes disable/reset/global logout
    // effective immediately instead of waiting for that expiry.
    const currentSession = await dependencies.db.get<{ id: string }>(
      "SELECT id FROM auth.sessions WHERE id = ? AND user_id = ?",
      claims.session_id,
      user.id,
    );
    if (!currentSession) return null;

    const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
    if (factorsError) return null;
    return {
      userId: user.id,
      sessionId: claims.session_id,
      email: user.email ?? "",
      emailVerified: Boolean(user.email_confirmed_at),
      aal: claims.aal === "aal2" ? "aal2" : "aal1",
      mfaEnrolled: factors.totp.some((factor) => factor.status === "verified"),
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

    if (request.method === "POST" && path === "sign-in/email") {
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (!email || !password) return finish(authError("Email and password are required."));
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) return finish(authError("Email or password is incorrect.", 401));
      const staff = await staffForUser(data.user.id);
      if (!staff || enabled(staff.banned) || !enabled(staff.emailVerified)) {
        await client.auth.signOut({ scope: "global" });
        return finish(authError("Email or password is incorrect.", 401));
      }
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
            email: staff.email,
            name: staff.name,
            twoFactorEnabled: identity.mfaEnrolled,
          },
          aal: identity.aal,
        }),
      );
    }

    if (request.method === "POST" && path === "two-factor/enable") {
      const { data: userData, error: userError } = await client.auth.getUser();
      const staff = userData.user ? await staffForUser(userData.user.id) : null;
      if (userError || !userData.user || !staff || enabled(staff.banned)) {
        return finish(authError("Sign in required.", 401));
      }
      const listed = await client.auth.mfa.listFactors();
      if (listed.error) return finish(authError());
      if (listed.data.totp.length > 0) {
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
      const { data: userData, error: userError } = await client.auth.getUser();
      const staff = userData.user ? await staffForUser(userData.user.id) : null;
      if (userError || !userData.user || !staff || enabled(staff.banned)) {
        return finish(authError("Sign in required.", 401));
      }
      const listed = await client.auth.mfa.listFactors();
      const factor = listed.data?.totp.find((candidate) =>
        requestedFactor ? candidate.id === requestedFactor : true,
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
        userData.user.id,
      );
      return finish(json({ success: true }));
    }

    if (request.method === "POST" && path === "sign-out") {
      const { error } = await client.auth.signOut({ scope: "local" });
      return finish(error ? authError() : json({ success: true }));
    }

    if (request.method === "POST" && path === "forget-password") {
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const member = email
        ? await dependencies.db.get<{ id: string; banned: unknown }>(
            `SELECT id, banned FROM staff_members WHERE lower(email) = lower(?)`,
            email,
          )
        : null;
      if (member && !enabled(member.banned)) {
        await client.auth.resetPasswordForEmail(email, {
          redirectTo: dependencies.baseUrl,
        });
      }
      return finish(json({ success: true }));
    }

    if (request.method === "POST" && (path === "reset-password" || path === "set-password")) {
      const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
      if (newPassword.length < 10) return finish(authError("Password must be at least 10 characters."));
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) return finish(authError("Sign in required.", 401));
      if (path === "reset-password") {
        const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        const staff = await dependencies.db.get<{ mfaRecoveryApprovedAt: string | null }>(
          `SELECT "mfaRecoveryApprovedAt" FROM staff_members WHERE "supabaseUserId" = ?`,
          userData.user.id,
        );
        const approvedAt = staff?.mfaRecoveryApprovedAt
          ? Date.parse(staff.mfaRecoveryApprovedAt)
          : Number.NaN;
        const operatorApproved =
          Number.isFinite(approvedAt) && Date.now() - approvedAt <= 30 * 60 * 1000;
        if (assurance.error || (assurance.data.currentLevel !== "aal2" && !operatorApproved)) {
          return finish(authError("Verify your authenticator before changing the password.", 403));
        }
      }
      const updated = await client.auth.updateUser({ password: newPassword });
      if (updated.error) return finish(authError(updated.error.message));
      await dependencies.db.run(
        `UPDATE staff_members
         SET "emailVerified" = ?, "invitationStatus" = 'accepted',
             "mfaRecoveryApprovedAt" = NULL, "updatedAt" = ?
         WHERE "supabaseUserId" = ?`,
        true,
        new Date().toISOString(),
        userData.user.id,
      );
      if (path === "reset-password") {
        await client.auth.signOut({ scope: "local" });
        await dependencies.db.run("DELETE FROM auth.sessions WHERE user_id = ?", userData.user.id);
      }
      return finish(json({ success: true }));
    }

    if (request.method === "GET" && path === "confirm") {
      const url = new URL(request.url);
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");
      if (!tokenHash || (type !== "invite" && type !== "recovery")) {
        return finish(authError("This authentication link is invalid or expired.", 400));
      }
      const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (verified.error || !verified.data.user) {
        return finish(authError("This authentication link is invalid or expired.", 400));
      }
      await dependencies.db.run(
        `UPDATE staff_members SET "emailVerified" = ?, "updatedAt" = ? WHERE "supabaseUserId" = ?`,
        true,
        new Date().toISOString(),
        verified.data.user.id,
      );
      const destination = type === "invite" ? "/dashboard/accept-invitation" : "/dashboard/reset-password";
      return finish(Response.redirect(new URL(destination, dependencies.baseUrl), 303));
    }

    return finish(json({ error: { code: "not_found", message: "Authentication route not found." } }, 404));
  }

  return {
    authenticate,
    handle,
    async invite(email: string, name: string): Promise<{ userId: string }> {
      const existing = await findAuthUserByEmail(admin, email);
      if (existing?.email_confirmed_at) {
        throw new Error("An accepted Supabase Auth user already exists for this email.");
      }
      if (existing) {
        const removed = await admin.auth.admin.deleteUser(existing.id);
        if (removed.error) throw removed.error;
      }
      const invited = await admin.auth.admin.inviteUserByEmail(email, {
        data: { name },
        redirectTo: dependencies.baseUrl,
      });
      if (invited.error || !invited.data.user) throw invited.error ?? new Error("Invitation failed.");
      return { userId: invited.data.user.id };
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
