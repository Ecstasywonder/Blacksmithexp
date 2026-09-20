import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for database migrations");
}

const migrationsDirectory = resolve(import.meta.dirname, "../migrations");
const sqlClient = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sqlClient.unsafe(`
    create table if not exists public.schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    const alreadyApplied = await sqlClient<{ id: string }[]>`
      select id
      from public.schema_migrations
      where id = ${migrationFile}
      limit 1
    `;

    if (alreadyApplied.length > 0) {
      console.log(`[migrate] skipped ${migrationFile}`);
      continue;
    }

    const migrationSql = await readFile(
      resolve(migrationsDirectory, migrationFile),
      "utf8",
    );

    await sqlClient.unsafe(migrationSql);
    await sqlClient`
      insert into public.schema_migrations (id)
      values (${migrationFile})
    `;

    console.log(`[migrate] applied ${migrationFile}`);
  }
} finally {
  await sqlClient.end();
}
