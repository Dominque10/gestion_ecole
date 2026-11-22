-- Notes (3b) : isolation entre écoles (RLS), lecture seule des années archivées,
-- note jamais au-dessus du barème de l'évaluation.

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY assessments_tenant ON assessments FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades FORCE ROW LEVEL SECURITY;
CREATE POLICY grades_tenant ON grades FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

CREATE TRIGGER assessments_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON assessments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();
CREATE TRIGGER grades_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON grades
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

CREATE OR REPLACE FUNCTION app.check_grade_within_scale() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.score IS NOT NULL
     AND NEW.score > (SELECT max_score FROM assessments WHERE id = NEW.assessment_id) THEN
    RAISE EXCEPTION 'Note au-dessus du barème de l''évaluation' USING ERRCODE = 'GS007';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grades_within_scale
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION app.check_grade_within_scale();

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
