-- Clôtures de caisse : isolation entre écoles (RLS) ; jamais supprimées ; une seule modification
-- permise : la réouverture par le directeur (statut, auteur, date, motif), rien d'autre.

ALTER TABLE cash_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_closures FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_closures_tenant ON cash_closures FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());
REVOKE DELETE ON cash_closures FROM app_user;

CREATE OR REPLACE FUNCTION app.guard_cash_closure() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cash_closures est définitif (DELETE interdit)' USING ERRCODE = 'GS005';
  END IF;
  IF OLD.status <> 'closed' OR NEW.status <> 'reopened'
     OR (NEW.school_id, NEW.cashier_id, NEW.day, NEW.receipt_count, NEW.cash_total,
         NEW.mobile_money_total, NEW.transfer_total, NEW.cheque_total, NEW.total,
         NEW.counted_cash, NEW.difference, NEW.note, NEW.closed_at)
        IS DISTINCT FROM
        (OLD.school_id, OLD.cashier_id, OLD.day, OLD.receipt_count, OLD.cash_total,
         OLD.mobile_money_total, OLD.transfer_total, OLD.cheque_total, OLD.total,
         OLD.counted_cash, OLD.difference, OLD.note, OLD.closed_at) THEN
    RAISE EXCEPTION 'Une clôture ne se modifie pas : seule la réouverture est permise' USING ERRCODE = 'GS005';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cash_closures_guard
  BEFORE UPDATE OR DELETE ON cash_closures
  FOR EACH ROW EXECUTE FUNCTION app.guard_cash_closure();
