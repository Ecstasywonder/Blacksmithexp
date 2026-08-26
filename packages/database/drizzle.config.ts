import { defineConfig } from "drizzle-kit";

// Migrations must always use the privileged migration role, never the runtime role.
if (!process.env.MIGRATION_DATABASE_URL) {
  throw new Error("MIGRATION_DATABASE_URL is required for database migrations");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations/generated",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL },
  strict: true,
  verbose: true,
});
