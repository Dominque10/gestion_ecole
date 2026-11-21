-- Inscriptions : isolation entre écoles (RLS), lecture seule des années archivées, jamais supprimées
-- (pivot des notes, absences et échéances : l'historique doit rester).

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollments_tenant ON enrollments FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());
REVOKE DELETE ON enrollments FROM app_user;

CREATE TRIGGER enrollments_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();
