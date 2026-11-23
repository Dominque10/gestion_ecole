-- Paiement en ligne (4c) : isolation entre écoles (RLS), règles « parent » (il voit ses intentions,
-- n'écrit rien : le serveur écrit au nom du compte caisse en ligne), historique jamais supprimé.

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_intents_tenant ON payment_intents FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());
REVOKE DELETE ON payment_intents FROM app_user;

CREATE TRIGGER payment_intents_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON payment_intents
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

CREATE POLICY payment_intents_parent_read ON payment_intents AS RESTRICTIVE FOR SELECT
  USING (NOT app.current_user_is_parent_only() OR enrollment_id IN (SELECT app.parent_enrollment_ids()));
CREATE POLICY payment_intents_parent_insert ON payment_intents AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT app.current_user_is_parent_only());
CREATE POLICY payment_intents_parent_update ON payment_intents AS RESTRICTIVE FOR UPDATE
  USING (NOT app.current_user_is_parent_only());
CREATE POLICY payment_intents_parent_delete ON payment_intents AS RESTRICTIVE FOR DELETE
  USING (NOT app.current_user_is_parent_only());

-- Message de confirmation d'un prestataire (sans école de session) : retrouver l'école et l'intention
-- à partir de la référence du prestataire. Ne renvoie que ces deux identifiants.
CREATE OR REPLACE FUNCTION app.intent_by_provider_ref(p_provider text, p_ref text)
  RETURNS TABLE (school_id uuid, intent_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$ SELECT school_id, id FROM public.payment_intents WHERE provider = p_provider AND provider_ref = p_ref $$;

REVOKE ALL ON FUNCTION app.intent_by_provider_ref(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.intent_by_provider_ref(text, text) TO app_user;
