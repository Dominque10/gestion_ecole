-- Remise d'un mot de passe provisoire par le directeur (décision D5, H9) : permise seulement si le
-- compte n'appartient à aucune autre école. La RLS cache les autres écoles au directeur ; cette
-- fonction ne révèle qu'un oui / non, jamais lesquelles. Les accès Support ne comptent pas.
CREATE OR REPLACE FUNCTION app.user_in_other_school(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.memberships
      WHERE user_id = p_user
        AND school_id IS DISTINCT FROM app.current_school_id()
        AND roles <> '{support}'::membership_role[]
    )
  $$;

REVOKE ALL ON FUNCTION app.user_in_other_school(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.user_in_other_school(uuid) TO app_user;
