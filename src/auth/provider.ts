import type { AppDatabase } from "../db/appDatabase";
import type { MailTransport } from "../mail/outbox";

/** Verified identity from the authentication service; application roles live in our database. */
export interface AuthIdentity {
  userId: string;
  sessionId: string;
  email: string;
  emailVerified: boolean;
  aal: "aal1" | "aal2";
  mfaEnrolled: boolean;
}

export interface AuthProvider {
  authenticate(headers: Headers): Promise<AuthIdentity | null>;
  handle(request: Request): Promise<Response>;
  invite(email: string, name: string): Promise<{ userId: string }>;
  revokeAll(userId: string): Promise<void>;
  disable(userId: string): Promise<void>;
}

export interface AuthDependencies {
  db: AppDatabase;
  mail: MailTransport;
  baseUrl: string;
}
