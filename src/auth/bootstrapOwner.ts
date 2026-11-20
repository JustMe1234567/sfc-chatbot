import { postgresAppDatabase } from "../db/appDatabase";
import { migratePostgres, openPostgres } from "../db/postgres";
import { appBaseUrl } from "../config";
import { assertSupabaseConfigured, createSupabaseAuth } from "./supabase-provider";
import { provisionStaffMember } from "./provision";

export interface BootstrapOwnerInput {
  username: string;
  password: string;
  name: string;
  databaseUrl: string;
}

export interface BootstrapOwnerResult {
  userId: string;
  username: string;
  role: string;
  store: string;
}

/** Creates the first owner in the configured Supabase test/production project. */
export async function bootstrapOwner(input: BootstrapOwnerInput): Promise<BootstrapOwnerResult> {
  assertSupabaseConfigured();
  const sql = openPostgres(input.databaseUrl);
  try {
    await migratePostgres(sql);
    const db = postgresAppDatabase(sql);
    const auth = createSupabaseAuth({
      db,
      baseUrl: appBaseUrl(),
    });
    const owner = await provisionStaffMember(auth, db, {
      username: input.username,
      password: input.password,
      name: input.name,
      role: "owner",
    });
    return { ...owner, store: `Postgres database at ${safePostgresTarget(input.databaseUrl)}` };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function safePostgresTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(an unparseable connection string)";
  }
}
