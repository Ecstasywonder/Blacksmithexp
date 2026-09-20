DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chairly_migrator') THEN
    CREATE ROLE chairly_migrator LOGIN PASSWORD 'chairly_migrator' BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chairly_app') THEN
    CREATE ROLE chairly_app LOGIN PASSWORD 'chairly_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE chairly TO chairly_migrator;
GRANT CONNECT ON DATABASE chairly TO chairly_app;
GRANT TEMPORARY, CREATE ON DATABASE chairly TO chairly_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO chairly_migrator;
GRANT USAGE ON SCHEMA public TO chairly_app;
