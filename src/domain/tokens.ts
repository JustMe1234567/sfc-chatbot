import { createHash, randomBytes } from "node:crypto";

/** Visitor credentials are short-lived and scoped to one conversation. */
export const VISITOR_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(): string {
  return new Date(Date.now() + VISITOR_SESSION_TTL_MS).toISOString();
}
