import "server-only";

import { createDatabase } from "@chairly/database";

const globalDatabase = globalThis as typeof globalThis & {
  chairlyDatabase?: ReturnType<typeof createDatabase>;
};

export function getDatabase() {
  if (globalDatabase.chairlyDatabase) {
    return globalDatabase.chairlyDatabase;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required by server database routes");
  }

  const database = createDatabase(databaseUrl);

  if (process.env.NODE_ENV !== "production") {
    globalDatabase.chairlyDatabase = database;
  }

  return database;
}
