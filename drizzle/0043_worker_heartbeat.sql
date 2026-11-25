-- Dernier passage du worker (mise en service, Sb), lu par /api/v1/health : une panne du worker
-- (SMS, PDF, paiements en ligne bloqués) ne doit pas rester silencieuse.
-- Donnée purement technique, sans aucune donnée d'école : table du schéma app (hors des tables
-- métier de public), inaccessible directement à app_user, lue et écrite par deux fonctions.
CREATE TABLE app.worker_heartbeat (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_seen_at timestamptz NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON app.worker_heartbeat FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.record_worker_heartbeat()
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    INSERT INTO app.worker_heartbeat (id, last_seen_at) VALUES (true, now())
    ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.worker_last_seen()
  RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT last_seen_at FROM app.worker_heartbeat $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.record_worker_heartbeat() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.worker_last_seen() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.record_worker_heartbeat() TO app_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.worker_last_seen() TO app_user;
