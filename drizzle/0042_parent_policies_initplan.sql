-- Performance (4f) : dans les règles d'accès des parents, `app.current_user_is_parent_only()` était
-- réévaluée pour CHAQUE ligne lue (fonction SECURITY DEFINER, donc jamais « dépliée » par le planificateur) :
-- 2 s pour compter 70 000 appels. Entourée d'un SELECT, elle devient un « InitPlan » calculé une seule
-- fois par requête. Le sens des règles ne change pas.
-- Les règles créées plus tard doivent employer la même forme : (SELECT app.current_user_is_parent_only()).

DO $$
DECLARE
  p record;
  fn constant text := 'app.current_user_is_parent_only()';
  wrapped constant text := '(SELECT app.current_user_is_parent_only())';
BEGIN
  FOR p IN
    SELECT tablename, policyname, qual, with_check FROM pg_policies
    WHERE schemaname = 'public'
      AND (position(fn IN coalesce(qual, '')) > 0 OR position(fn IN coalesce(with_check, '')) > 0)
  LOOP
    IF p.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I USING (%s)', p.policyname, p.tablename,
        replace(p.qual, fn, wrapped));
    END IF;
    IF p.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I WITH CHECK (%s)', p.policyname, p.tablename,
        replace(p.with_check, fn, wrapped));
    END IF;
  END LOOP;
END $$;
