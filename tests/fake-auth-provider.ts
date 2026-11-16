import { randomUUID } from "node:crypto";
import { TOTP } from "otpauth";
import type {
  AuthDependencies,
  AuthIdentity,
  AuthProvider,
} from "../src/auth/provider";

const COOKIE = "sfc_test_auth";

interface FakeUser {
  id: string;
  email: string;
  name: string;
  password: string | null;
  confirmed: boolean;
  banned: boolean;
  factorId: string | null;
  totp: TOTP | null;
}

interface FakeSession {
  id: string;
  userId: string;
  aal: "aal1" | "aal2";
  expiresAt: number;
  recoveryToken?: string;
}

export interface FakeStaffRegistration {
  userId: string;
  email: string;
  name: string;
  password: string;
  confirmed?: boolean;
}

class FakeAuthProvider implements AuthProvider {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();
  readonly resetTokens = new Map<string, { userId: string; used: boolean }>();
  readonly inviteTokens = new Map<string, { userId: string; used: boolean }>();
  readonly failedSignIns = new Map<string, number>();

  constructor(private readonly dependencies: AuthDependencies) {}

  register(input: FakeStaffRegistration): void {
    this.users.set(input.userId, {
      id: input.userId,
      email: input.email.toLowerCase(),
      name: input.name,
      password: input.password,
      confirmed: input.confirmed ?? true,
      banned: false,
      factorId: null,
      totp: null,
    });
  }

  expire(email: string): void {
    const user = [...this.users.values()].find((candidate) => candidate.email === email.toLowerCase());
    if (!user) return;
    for (const session of this.sessions.values()) {
      if (session.userId === user.id) session.expiresAt = 0;
    }
  }

  private token(headers: Headers): string | null {
    const cookie = headers.get("cookie") ?? "";
    for (const item of cookie.split(";")) {
      const [name, ...rest] = item.trim().split("=");
      if (name === COOKIE) return rest.join("=");
    }
    return null;
  }

  private session(headers: Headers): FakeSession | null {
    const token = this.token(headers);
    const session = token ? this.sessions.get(token) : null;
    if (!session || session.expiresAt <= Date.now()) return null;
    return session;
  }

  private response(body: unknown, status = 200, cookie?: string): Response {
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    });
    if (cookie !== undefined) {
      headers.append(
        "Set-Cookie",
        `${COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax${cookie ? "" : "; Max-Age=0"}`,
      );
    }
    return new Response(JSON.stringify(body), { status, headers });
  }

  private error(message: string, status = 400): Response {
    return this.response({ error: { code: "authentication_failed", message } }, status);
  }

  async authenticate(headers: Headers): Promise<AuthIdentity | null> {
    const session = this.session(headers);
    if (!session) return null;
    const user = this.users.get(session.userId);
    if (!user || user.banned) return null;
    return {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      emailVerified: user.confirmed,
      aal: session.aal,
      mfaEnrolled: user.totp !== null,
    };
  }

  async handle(request: Request): Promise<Response> {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const referer = request.headers.get("referer");
      let trusted = origin;
      if (!trusted && referer) {
        try {
          trusted = new URL(referer).origin;
        } catch {
          trusted = null;
        }
      }
      if (trusted !== new URL(this.dependencies.baseUrl).origin) {
        return this.response(
          { error: { code: "cross_origin_blocked", message: "Request origin is not allowed." } },
          403,
        );
      }
    }
    const path = new URL(request.url).pathname.replace(/^\/api\/auth\/?/, "");
    const body = request.method === "POST"
      ? ((await request.json().catch(() => null)) as Record<string, unknown> | null)
      : null;

    if (request.method === "POST" && path === "sign-in/email") {
      const email = typeof body?.email === "string" ? body.email.toLowerCase() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const user = [...this.users.values()].find((candidate) => candidate.email === email);
      const staff = user
        ? await this.dependencies.db.get<{ banned: unknown; emailVerified: unknown }>(
            `SELECT banned, "emailVerified" FROM staff_members WHERE "supabaseUserId" = ?`,
            user.id,
          )
        : null;
      const verified = staff?.emailVerified === true || staff?.emailVerified === 1;
      const banned = staff?.banned === true || staff?.banned === 1;
      if (!user || user.password !== password || user.banned || banned || !user.confirmed || !verified) {
        const client = request.headers.get("x-forwarded-for") ?? "unknown";
        const failures = (this.failedSignIns.get(client) ?? 0) + 1;
        this.failedSignIns.set(client, failures);
        if (failures > 10) return this.error("Too many attempts. Try again later.", 429);
        return this.error("Email or password is incorrect.", 401);
      }
      const token = randomUUID();
      this.sessions.set(token, {
        id: randomUUID(),
        userId: user.id,
        aal: "aal1",
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      return this.response({ twoFactorRedirect: user.totp !== null }, 200, token);
    }

    if (request.method === "GET" && path === "get-session") {
      const identity = await this.authenticate(request.headers);
      if (!identity) return this.response(null);
      const user = this.users.get(identity.userId)!;
      return this.response({
        user: { id: user.id, email: user.email, name: user.name, twoFactorEnabled: Boolean(user.totp) },
        aal: identity.aal,
      });
    }

    if (request.method === "POST" && path === "two-factor/enable") {
      const session = this.session(request.headers);
      const user = session ? this.users.get(session.userId) : null;
      if (!user) return this.error("Sign in required.", 401);
      user.factorId = randomUUID();
      user.totp = new TOTP({
        issuer: "Springfield College chat",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      return this.response({
        totpURI: user.totp.toString(),
        qrCode: "",
        factorId: user.factorId,
      });
    }

    if (request.method === "POST" && path === "two-factor/verify-totp") {
      const token = this.token(request.headers);
      const session = token ? this.sessions.get(token) : null;
      const user = session ? this.users.get(session.userId) : null;
      const code = typeof body?.code === "string" ? body.code : "";
      if (!session || !user?.totp || user.totp.validate({ token: code, window: 1 }) === null) {
        return this.error("The authenticator code is invalid.", 401);
      }
      session.aal = "aal2";
      await this.dependencies.db.run(
        `UPDATE staff_members SET "twoFactorEnabled" = ?, "emailVerified" = ?, "updatedAt" = ?
         WHERE "supabaseUserId" = ?`,
        true,
        true,
        new Date().toISOString(),
        user.id,
      );
      return this.response({ success: true }, 200, token ?? undefined);
    }

    if (request.method === "POST" && path === "sign-out") {
      const token = this.token(request.headers);
      if (token) this.sessions.delete(token);
      return this.response({ success: true }, 200, "");
    }

    if (request.method === "POST" && path === "forget-password") {
      const email = typeof body?.email === "string" ? body.email.toLowerCase() : "";
      const user = [...this.users.values()].find((candidate) => candidate.email === email && !candidate.banned);
      if (user) {
        const token = randomUUID().replace(/-/g, "");
        this.resetTokens.set(token, { userId: user.id, used: false });
        await this.dependencies.mail.send({
          to: user.email,
          subject: "Reset your Springfield College chat password",
          body: `${this.dependencies.baseUrl}/api/auth/confirm?token_hash=${token}&type=recovery`,
        });
      }
      return this.response({ success: true });
    }

    if (request.method === "GET" && path === "confirm") {
      const url = new URL(request.url);
      const token = url.searchParams.get("token_hash") ?? "";
      const type = url.searchParams.get("type");
      const recovery = this.resetTokens.get(token);
      const invitation = this.inviteTokens.get(token);
      const grant = type === "recovery" ? recovery : type === "invite" ? invitation : null;
      if (!grant || grant.used) {
        return this.error("This authentication link is invalid or expired.");
      }
      grant.used = true;
      const user = this.users.get(grant.userId);
      if (!user) return this.error("This authentication link is invalid or expired.");
      user.confirmed = true;
      const sessionToken = randomUUID();
      this.sessions.set(sessionToken, {
        id: randomUUID(),
        userId: grant.userId,
        aal: "aal1",
        expiresAt: Date.now() + 60 * 60 * 1000,
        ...(type === "recovery" ? { recoveryToken: token } : {}),
      });
      return new Response(null, {
        status: 303,
        headers: {
          Location: `${this.dependencies.baseUrl}${type === "invite" ? "/dashboard/accept-invitation" : "/dashboard/reset-password"}`,
          "Set-Cookie": `${COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (request.method === "POST" && path === "set-password") {
      const session = this.session(request.headers);
      const user = session ? this.users.get(session.userId) : null;
      const password = typeof body?.newPassword === "string" ? body.newPassword : "";
      if (!session || !user || password.length < 10) {
        return this.error("Password must be at least 10 characters.");
      }
      user.password = password;
      await this.dependencies.db.run(
        `UPDATE staff_members
         SET "emailVerified" = ?, "invitationStatus" = 'accepted', "updatedAt" = ?
         WHERE "supabaseUserId" = ?`,
        true,
        new Date().toISOString(),
        user.id,
      );
      return this.response({ success: true });
    }

    if (request.method === "POST" && path === "reset-password") {
      const token = this.token(request.headers);
      const session = token ? this.sessions.get(token) : null;
      const password = typeof body?.newPassword === "string" ? body.newPassword : "";
      const user = session ? this.users.get(session.userId) : null;
      if (!session || session.aal !== "aal2" || !user || password.length < 10) {
        return this.error("Verify your authenticator before changing the password.", 403);
      }
      user.password = password;
      await this.revokeAll(user.id);
      return this.response({ success: true }, 200, "");
    }

    return this.response({ error: { code: "not_found", message: "Authentication route not found." } }, 404);
  }

  async invite(email: string, name: string): Promise<{ userId: string }> {
    const existing = [...this.users.values()].find((candidate) => candidate.email === email.toLowerCase());
    if (existing?.confirmed) throw new Error("An accepted Supabase Auth user already exists for this email.");
    if (existing) {
      this.users.delete(existing.id);
      for (const [token, invitation] of this.inviteTokens) {
        if (invitation.userId === existing.id) this.inviteTokens.delete(token);
      }
    }
    const userId = randomUUID();
    this.users.set(userId, {
      id: userId,
      email: email.toLowerCase(),
      name,
      password: null,
      confirmed: false,
      banned: false,
      factorId: null,
      totp: null,
    });
    const token = randomUUID().replace(/-/g, "");
    this.inviteTokens.set(token, { userId, used: false });
    await this.dependencies.mail.send({
      to: email,
      subject: "Springfield College chat staff invitation",
      body: `${this.dependencies.baseUrl}/api/auth/confirm?token_hash=${token}&type=invite`,
    });
    return { userId };
  }

  async revokeAll(userId: string): Promise<void> {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }

  async disable(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.banned = true;
    await this.revokeAll(userId);
  }
}

let activeProvider: FakeAuthProvider | null = null;

export function assertSupabaseConfigured(): void {}

export function createSupabaseAuth(dependencies: AuthDependencies): AuthProvider {
  activeProvider = new FakeAuthProvider(dependencies);
  return activeProvider;
}

export function registerFakeStaff(input: FakeStaffRegistration): void {
  if (!activeProvider) throw new Error("The fake auth provider has not been created.");
  activeProvider.register(input);
}

export function expireFakeSessions(email: string): void {
  if (!activeProvider) throw new Error("The fake auth provider has not been created.");
  activeProvider.expire(email);
}
