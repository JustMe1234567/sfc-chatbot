// The `pg` package ships no type declarations and @types/pg is not a
// dependency; the only consumer (the Kysely PostgresDialect pool in
// src/db/service.ts) is therefore typed loosely.
declare module "pg";
