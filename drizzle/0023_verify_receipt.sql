-- Vérification publique d'un reçu (QR code). SECURITY DEFINER : contourne la RLS, donc ne renvoie
-- que le strict nécessaire — école, numéro, date, montant, annulé ou non. Jamais le nom de l'élève.
-- L'application n'appelle cette fonction qu'après avoir vérifié la signature du lien.
CREATE OR REPLACE FUNCTION app.verify_receipt(p_payment uuid)
  RETURNS TABLE (school_name text, receipt_number text, amount integer, paid_at timestamptz, reversed boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT s.name, p.receipt_number, p.amount, p.paid_at,
           EXISTS (SELECT 1 FROM public.payments r WHERE r.reverses_id = p.id)
    FROM public.payments p
    JOIN public.schools s ON s.id = p.school_id
    WHERE p.id = p_payment AND p.kind = 'payment'
  $$;

REVOKE ALL ON FUNCTION app.verify_receipt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_receipt(uuid) TO app_user;
