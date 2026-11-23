-- Clôture des périodes par classe (3d) : isolation entre écoles (RLS), lecture seule des années
-- archivées, et verrouillage garanti par la base : aucune évaluation ni note ne change dans une
-- période close pour la classe.

ALTER TABLE period_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_closures FORCE ROW LEVEL SECURITY;
CREATE POLICY period_closures_tenant ON period_closures FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

CREATE TRIGGER period_closures_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON period_closures
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();
-- L'historique des clôtures se garde : pas de suppression.
REVOKE DELETE ON period_closures FROM app_user;

CREATE OR REPLACE FUNCTION app.period_closed(p_period uuid, p_class uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (
    SELECT 1 FROM period_closures WHERE period_id = p_period AND class_id = p_class AND closed
  ) $$;

CREATE OR REPLACE FUNCTION app.forbid_assessment_in_closed_period() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND app.period_closed(OLD.period_id, OLD.class_id))
     OR (TG_OP <> 'DELETE' AND app.period_closed(NEW.period_id, NEW.class_id)) THEN
    RAISE EXCEPTION 'Période close pour cette classe : notes verrouillées' USING ERRCODE = 'GS008';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER assessments_closed_period
  BEFORE INSERT OR UPDATE OR DELETE ON assessments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_assessment_in_closed_period();

CREATE OR REPLACE FUNCTION app.forbid_grade_in_closed_period() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ids uuid[];
BEGIN
  ids := CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[NEW.assessment_id]
    WHEN 'DELETE' THEN ARRAY[OLD.assessment_id]
    ELSE ARRAY[OLD.assessment_id, NEW.assessment_id]
  END;
  IF EXISTS (
    SELECT 1 FROM assessments a
    WHERE a.id = ANY (ids) AND app.period_closed(a.period_id, a.class_id)
  ) THEN
    RAISE EXCEPTION 'Période close pour cette classe : notes verrouillées' USING ERRCODE = 'GS008';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER grades_closed_period
  BEFORE INSERT OR UPDATE OR DELETE ON grades
  FOR EACH ROW EXECUTE FUNCTION app.forbid_grade_in_closed_period();

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
