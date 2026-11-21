-- Structure pédagogique : isolation entre écoles (RLS) et lecture seule des années archivées.

ALTER TABLE levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE levels FORCE ROW LEVEL SECURITY;
CREATE POLICY levels_tenant ON levels FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY subjects_tenant ON subjects FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE level_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY level_subjects_tenant ON level_subjects FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes FORCE ROW LEVEL SECURITY;
CREATE POLICY classes_tenant ON classes FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY class_subjects_tenant ON class_subjects FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_tenant ON staff FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

-- Une année archivée est en lecture seule : grille, classes et affectations comprises.
CREATE TRIGGER level_subjects_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON level_subjects
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

CREATE TRIGGER classes_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON classes
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

CREATE TRIGGER class_subjects_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON class_subjects
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();
