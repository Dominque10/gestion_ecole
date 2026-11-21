-- Échéances : isolation entre écoles (RLS), lecture seule des années archivées.
-- Une échéance annulée le reste : on ne la rouvre pas (une nouvelle échéance la remplace au besoin).

ALTER TABLE schools ADD CONSTRAINT schools_sibling_discount CHECK (sibling_discount_percent BETWEEN 0 AND 100);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant ON invoices FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

CREATE TRIGGER invoices_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

CREATE OR REPLACE FUNCTION app.forbid_invoice_reopen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Échéance annulée : elle ne peut plus être modifiée' USING ERRCODE = 'GS004';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoices_no_reopen
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.forbid_invoice_reopen();
