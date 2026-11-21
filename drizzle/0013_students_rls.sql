-- Élèves : isolation entre écoles (RLS), données médicales réservées à la direction (décision A4),
-- fiches jamais supprimées (hypothèse H43).

-- Rôle de l'utilisateur de la session dans l'école de la session (appartenance visible par la RLS).
CREATE OR REPLACE FUNCTION app.current_user_has_role(p_role membership_role) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.memberships
      WHERE school_id = app.current_school_id()
        AND user_id = app.current_user_id()
        AND p_role = ANY (roles)
        AND (expires_at IS NULL OR expires_at > now())
    )
  $$;
GRANT EXECUTE ON FUNCTION app.current_user_has_role(membership_role) TO app_user;

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
CREATE POLICY students_tenant ON students FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());
REVOKE DELETE ON students FROM app_user;

-- Données médicales : même l'application ne les lit qu'avec une session de directeur.
ALTER TABLE student_medical ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_medical FORCE ROW LEVEL SECURITY;
CREATE POLICY student_medical_director ON student_medical FOR ALL
  USING (school_id = app.current_school_id() AND app.current_user_has_role('director'))
  WITH CHECK (school_id = app.current_school_id() AND app.current_user_has_role('director'));

ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY guardians_tenant ON guardians FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY student_guardians_tenant ON student_guardians FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY student_documents_tenant ON student_documents FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());
