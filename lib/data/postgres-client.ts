import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Pool } from "pg";

/** Lazily constructed so Firestore-only deployments never require DATABASE_URL. */
export function postgresDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required for PostgreSQL messaging persistence.");
  return drizzle(neon(url));
}

let transactionPool: Pool | undefined;
/** Dedicated transaction-capable connection for the few operations that need
 * multi-statement atomicity. Uses the same DATABASE_URL and staging guard. */
export function postgresTransactionPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required for PostgreSQL messaging persistence.");
  transactionPool ??= new Pool({ connectionString: url, max: 4 });
  return transactionPool;
}
