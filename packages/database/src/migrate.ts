import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationDatabaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required for database migrations");
}

const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

function migrationBody(source: string): string {
  const withoutBegin = source.replace(/^\s*BEGIN;\s*/i, "");
  const withoutCommit = withoutBegin.replace(/\s*COMMIT;\s*$/i, "");

  if (withoutBegin === source || withoutCommit === withoutBegin) {
    throw new Error(
      "Reviewed migrations must have outer BEGIN and COMMIT statements",
    );
  }

  return withoutCommit;
}

const client = postgres(migrationDatabaseUrl, { prepare: false, max: 1 });

try {
  await client`
    create table if not exists chairly_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => migrationFilePattern.test(filename))
    .sort();

  for (const filename of filenames) {
    const source = await readFile(join(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");

    await client.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtext('chairly-schema-migrations'))
      `;
      const applied = await transaction<{ checksum: string }[]>`
        select checksum
        from chairly_schema_migrations
        where filename = ${filename}
      `;

      if (applied[0]) {
        if (applied[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${filename}`);
        }
        return;
      }

      await transaction.unsafe(migrationBody(source));
      await transaction`
        insert into chairly_schema_migrations (filename, checksum)
        values (${filename}, ${checksum})
      `;
    });
  }
} finally {
  await client.end();
}
