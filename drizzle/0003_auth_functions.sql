-- Connexion : retrouver une école par son code AVANT d'avoir une école de session.
-- SECURITY DEFINER = contourne la RLS, donc renvoie le strict minimum (identifiant), écoles actives seules.
CREATE OR REPLACE FUNCTION app.school_id_by_code(p_code text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT id FROM public.schools WHERE code = lower(p_code) AND status = 'active' $$;

REVOKE ALL ON FUNCTION app.school_id_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.school_id_by_code(text) TO app_user;
