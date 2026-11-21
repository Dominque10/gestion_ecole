-- Isolation entre écoles (Row-Level Security) et droits du rôle applicatif app_user.
-- Règle : toute table métier (avec school_id) a RLS activée ET forcée, et une politique
-- fondée sur app.current_school_id(). Le test tests/integration/rls.test.ts le vérifie.

-- 1. Fonctions de contexte de session ------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_school_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_school_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.is_platform() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.platform', true), '') = 'on' $$;

-- 2. Droits de app_user -------------------------------------------------------------
GRANT USAGE ON SCHEMA app TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- 3. schools : une école ne voit qu'elle-même ; seule la plateforme crée une école -------
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
CREATE POLICY schools_select ON schools FOR SELECT
  USING (id = app.current_school_id() OR app.is_platform());
CREATE POLICY schools_insert ON schools FOR INSERT
  WITH CHECK (app.is_platform());
CREATE POLICY schools_update ON schools FOR UPDATE
  USING (id = app.current_school_id() OR app.is_platform())
  WITH CHECK (id = app.current_school_id() OR app.is_platform());
REVOKE DELETE ON schools FROM app_user;

-- 4. memberships ---------------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant ON memberships FOR ALL
  USING (school_id = app.current_school_id() OR app.is_platform())
  WITH CHECK (school_id = app.current_school_id() OR app.is_platform());

-- 5. audit_logs : lecture et ajout seulement, jamais de modification ni de suppression ----
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (school_id = app.current_school_id() OR (school_id IS NULL AND app.is_platform()));
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (school_id = app.current_school_id() OR (school_id IS NULL AND app.is_platform()));
REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

CREATE OR REPLACE FUNCTION app.forbid_audit_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_logs est en ajout seul (% interdit)', TG_OP; END $$;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_audit_change();
