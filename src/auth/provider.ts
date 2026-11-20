import type { AppDatabase } from "../db/appDatabase";

/** Verified identity from the authentication service; application roles live in our database. */
export interface AuthIdentity {
  userId: string;
  sessionId: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthProvider {
  authenticate(headers: Headers): Promise<AuthIdentity | null>;
  handle(request: Request): Promise<Response>;
  createAccount(staffId: string, name: string, password: string): Promise<{ userId: string }>;
  resetPassword(userId: string, password: string): Promise<void>;
  revokeAll(userId: string): Promise<void>;
  disable(userId: string): Promise<void>;
}

export interface AuthDependencies {
  db: AppDatabase;
  baseUrl: string;
}
