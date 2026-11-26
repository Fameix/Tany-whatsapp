import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/data/postgres-schema.ts",
  out: "./drizzle-postgres",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
