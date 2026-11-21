-- Créneaux et grille tarifaire : isolation entre écoles (RLS), lecture seule des années archivées.

ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY time_slots_tenant ON time_slots FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE fee_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_items FORCE ROW LEVEL SECURITY;
CREATE POLICY fee_items_tenant ON fee_items FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

CREATE TRIGGER fee_items_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON fee_items
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();
