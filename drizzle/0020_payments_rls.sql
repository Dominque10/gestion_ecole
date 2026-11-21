-- Caisse : isolation entre écoles (RLS) ; paiements et répartitions jamais modifiés ni supprimés
-- (CLAUDE.md §6, Argent) ; une demande d'annulation n'est décidée qu'une fois.

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant ON payments FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_allocations_tenant ON payment_allocations FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE payment_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_cancellations_tenant ON payment_cancellations FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

-- Écritures définitives : ni droit de modifier ni de supprimer, et un déclencheur pour tous les comptes.
REVOKE UPDATE, DELETE ON payments FROM app_user;
REVOKE UPDATE, DELETE ON payment_allocations FROM app_user;
REVOKE DELETE ON payment_cancellations FROM app_user;

CREATE OR REPLACE FUNCTION app.forbid_money_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION '% est définitif (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'GS005'; END $$;

CREATE TRIGGER payments_immutable
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_money_change();
CREATE TRIGGER payment_allocations_immutable
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app.forbid_money_change();

CREATE OR REPLACE FUNCTION app.guard_cancellation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Demande d''annulation déjà décidée' USING ERRCODE = 'GS006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_cancellations_decided_once
  BEFORE UPDATE ON payment_cancellations
  FOR EACH ROW EXECUTE FUNCTION app.guard_cancellation();

-- Pas de nouveau paiement dans une année archivée.
CREATE TRIGGER payments_archived_year
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();
