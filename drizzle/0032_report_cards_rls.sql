-- Conseil de classe (3f) : isolation entre écoles (RLS), lecture seule des années archivées.

ALTER TABLE report_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY report_cards_tenant ON report_cards FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

CREATE TRIGGER report_cards_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON report_cards
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

REVOKE DELETE ON report_cards FROM app_user;
