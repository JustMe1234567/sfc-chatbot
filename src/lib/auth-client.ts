"use client";

interface ClientResult<T> {
  data: T | null;
  error: { message: string } | null;
}

async function request<T>(path: string, body?: unknown): Promise<ClientResult<T>> {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | T
      | { error?: { message?: string } }
      | null;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? payload.error?.message ?? "Authentication failed."
          : "Authentication failed.";
      return { data: null, error: { message } };
    }
    return { data: payload as T, error: null };
  } catch {
    return { data: null, error: { message: "Authentication service is unavailable." } };
  }
}

export const authClient = {
  getSession() {
    return request<{
      user: { id: string; email: string; name: string; twoFactorEnabled: boolean };
      aal: "aal1" | "aal2";
    } | null>("get-session");
  },
  signIn: {
    email(input: { email: string; password: string }) {
      return request<{ twoFactorRedirect: boolean }>("sign-in/email", input);
    },
  },
  twoFactor: {
    enable(_input?: { password?: string; method?: string; issuer?: string }) {
      return request<{ totpURI: string; qrCode: string; factorId: string }>("two-factor/enable", {});
    },
    verifyTotp(input: { code: string; factorId?: string }) {
      return request<{ success: true }>("two-factor/verify-totp", input);
    },
  },
  signOut() {
    return request<{ success: true }>("sign-out", {});
  },
  forgetPassword(email: string) {
    return request<{ success: true }>("forget-password", { email });
  },
  setPassword(newPassword: string) {
    return request<{ success: true }>("set-password", { newPassword });
  },
  resetPassword(newPassword: string) {
    return request<{ success: true }>("reset-password", { newPassword });
  },
};
