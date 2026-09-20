-- Local disposable database only. The web runtime cannot bypass tenant RLS.
CREATE ROLE chairly_app LOGIN PASSWORD 'local-runtime-only' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE chairly TO chairly_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chairly_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chairly_app;
