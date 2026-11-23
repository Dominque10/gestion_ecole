-- Espace parents (4a), décision A2 : un compte parent unique ; une seule fonction dédiée liste ses
-- enfants toutes écoles confondues (nom, classe, école) ; ensuite tout passe par la RLS, avec des
-- politiques « restrictives » : dans une école, un compte qui n'y est QUE parent ne voit que ses
-- enfants (et rien de la pédagogie hors bulletins publiés), et n'écrit rien.

-- Compte « parent seulement » dans l'école de session (un enseignant parent garde ses droits d'enseignant).
CREATE OR REPLACE FUNCTION app.current_user_is_parent_only() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT COALESCE((
      SELECT roles = ARRAY['parent']::membership_role[] FROM public.memberships
      WHERE school_id = app.current_school_id() AND user_id = app.current_user_id()
        AND (expires_at IS NULL OR expires_at > now())
    ), false)
  $$;

-- Élèves et inscriptions des enfants du compte de session, dans l'école de session.
CREATE OR REPLACE FUNCTION app.parent_student_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT sg.student_id FROM public.student_guardians sg
    JOIN public.guardians g ON g.id = sg.guardian_id
    WHERE g.school_id = app.current_school_id() AND g.user_id = app.current_user_id()
  $$;

CREATE OR REPLACE FUNCTION app.parent_enrollment_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT e.id FROM public.enrollments e
    WHERE e.school_id = app.current_school_id()
      AND e.student_id IN (SELECT app.parent_student_ids())
  $$;

-- La seule lecture qui traverse les écoles (décision A2) : les enfants du compte de session, avec
-- le strict nécessaire (école, nom, classe). Inscriptions en cours d'années non archivées.
CREATE OR REPLACE FUNCTION app.parent_children()
  RETURNS TABLE (school_id uuid, school_name text, enrollment_id uuid, last_name text,
                 first_names text, class_name text, level_name text, year_label text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT s.id, s.name, e.id, st.last_name, st.first_names, c.name, l.name, y.label
    FROM public.guardians g
    JOIN public.schools s ON s.id = g.school_id AND s.status = 'active'
    JOIN public.student_guardians sg ON sg.guardian_id = g.id
    JOIN public.students st ON st.id = sg.student_id
    JOIN public.enrollments e ON e.student_id = st.id AND e.status <> 'left'
    JOIN public.academic_years y ON y.id = e.academic_year_id AND y.status <> 'archived'
    JOIN public.levels l ON l.id = e.level_id
    LEFT JOIN public.classes c ON c.id = e.class_id
    WHERE g.user_id = app.current_user_id()
    ORDER BY s.name, st.last_name, st.first_names
  $$;

-- Avant la connexion : ce numéro est-il celui d'un responsable d'élève (école active) ? Renvoie
-- seulement le nom à donner au compte, ou rien.
CREATE OR REPLACE FUNCTION app.guardian_name_by_phone(p_phone text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT g.full_name FROM public.guardians g
    JOIN public.schools s ON s.id = g.school_id AND s.status = 'active'
    WHERE g.phone = p_phone
      AND EXISTS (SELECT 1 FROM public.student_guardians sg WHERE sg.guardian_id = g.id)
    ORDER BY g.created_at LIMIT 1
  $$;

-- Après un code SMS correct seulement (appelé par l'application) : relie le compte aux fiches de
-- responsable de ce numéro et lui donne le rôle parent dans chaque école concernée.
CREATE OR REPLACE FUNCTION app.attach_parent(p_user uuid, p_phone text) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.guardians g SET user_id = p_user
  FROM public.schools s
  WHERE s.id = g.school_id AND s.status = 'active' AND g.phone = p_phone AND g.user_id IS NULL;

  INSERT INTO public.memberships (school_id, user_id, roles)
  SELECT DISTINCT g.school_id, p_user, ARRAY['parent']::membership_role[]
  FROM public.guardians g JOIN public.schools s ON s.id = g.school_id AND s.status = 'active'
  WHERE g.user_id = p_user
  ON CONFLICT (school_id, user_id) DO UPDATE
    SET roles = array_append(public.memberships.roles, 'parent')
    WHERE NOT ('parent' = ANY (public.memberships.roles));

  SELECT count(DISTINCT g.school_id) INTO n FROM public.guardians g WHERE g.user_id = p_user;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION app.parent_children() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.guardian_name_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.attach_parent(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;

-- Lecture par un compte « parent seulement » : ses enfants seulement.
DO $$
DECLARE
  rule record;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('students', 'id IN (SELECT app.parent_student_ids())'),
    ('student_guardians', 'student_id IN (SELECT app.parent_student_ids())'),
    ('guardians', 'user_id = app.current_user_id()'),
    ('memberships', 'user_id = app.current_user_id()'),
    ('enrollments', 'id IN (SELECT app.parent_enrollment_ids())'),
    ('invoices', 'enrollment_id IN (SELECT app.parent_enrollment_ids())'),
    ('payments', 'enrollment_id IN (SELECT app.parent_enrollment_ids())'),
    ('payment_allocations', 'payment_id IN (SELECT p.id FROM payments p WHERE p.enrollment_id IN (SELECT app.parent_enrollment_ids()))'),
    ('attendance', 'enrollment_id IN (SELECT app.parent_enrollment_ids())'),
    ('notifications', 'enrollment_id IN (SELECT app.parent_enrollment_ids())'),
    -- Bulletins : publiés seulement (décision D20 : les notes se voient par les bulletins publiés).
    ('report_cards', 'published_at IS NOT NULL AND enrollment_id IN (SELECT app.parent_enrollment_ids())'),
    -- Référentiel de l'école (sans donnée personnelle) : lisible.
    ('academic_years', 'true'), ('periods', 'true'), ('levels', 'true'), ('classes', 'true'),
    ('subjects', 'true'), ('class_subjects', 'true'), ('level_subjects', 'true'),
    ('time_slots', 'true'), ('fee_items', 'true'),
    -- Rien d'autre : notes isolées, évaluations, journal, caisse, personnel, pièces, médical…
    ('assessments', 'false'), ('grades', 'false'), ('audit_logs', 'false'),
    ('cash_closures', 'false'), ('payment_cancellations', 'false'), ('staff', 'false'),
    ('student_documents', 'false'), ('student_medical', 'false'), ('period_closures', 'false')
  ) AS r(tbl, cond) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (NOT app.current_user_is_parent_only() OR (%s))',
      rule.tbl || '_parent_read', rule.tbl, rule.cond);
    -- Aucune écriture par un compte « parent seulement » (le paiement en ligne passera par le worker).
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app.current_user_is_parent_only())',
      rule.tbl || '_parent_insert', rule.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE USING (NOT app.current_user_is_parent_only())',
      rule.tbl || '_parent_update', rule.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (NOT app.current_user_is_parent_only())',
      rule.tbl || '_parent_delete', rule.tbl);
  END LOOP;
END $$;
