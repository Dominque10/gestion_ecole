-- Années scolaires et périodes : isolation entre écoles (RLS) et garde-fous de la base.
-- Une année archivée est en lecture seule, définitivement : notes, paiements et bulletins d'une année
-- close ne doivent plus bouger. L'application vérifie avant ; la base refuse quoi qu'il arrive.

-- 1. RLS ---------------------------------------------------------------------------
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years FORCE ROW LEVEL SECURITY;
CREATE POLICY academic_years_tenant ON academic_years FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE periods FORCE ROW LEVEL SECURITY;
CREATE POLICY periods_tenant ON periods FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());

-- 2. Cycle de vie d'une année ---------------------------------------------------------
-- Transitions permises : en préparation → active → archivée. Rien ne sort de « archivée ».
-- Seule une année en préparation peut être supprimée.
CREATE OR REPLACE FUNCTION app.guard_academic_year() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'upcoming' THEN
      RAISE EXCEPTION 'Seule une année en préparation peut être supprimée' USING ERRCODE = 'GS003';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'Année archivée : lecture seule' USING ERRCODE = 'GS001';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'upcoming' AND NEW.status = 'active')
    OR (OLD.status = 'active' AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'Changement de statut interdit (% → %)', OLD.status, NEW.status USING ERRCODE = 'GS002';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER academic_years_guard
  BEFORE UPDATE OR DELETE ON academic_years
  FOR EACH ROW EXECUTE FUNCTION app.guard_academic_year();

-- Une année se crée toujours « en préparation » (l'activation est une étape explicite).

CREATE OR REPLACE FUNCTION app.guard_academic_year_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status <> 'upcoming' THEN
    RAISE EXCEPTION 'Une année se crée en préparation' USING ERRCODE = 'GS002';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER academic_years_guard_insert
  BEFORE INSERT ON academic_years
  FOR EACH ROW EXECUTE FUNCTION app.guard_academic_year_insert();

-- 3. Données rattachées à une année archivée : lecture seule ------------------------------
-- Fonction générique, à réutiliser sur toute future table qui a une colonne academic_year_id.
CREATE OR REPLACE FUNCTION app.forbid_write_in_archived_year() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  year_ids uuid[];
BEGIN
  year_ids := CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[NEW.academic_year_id]
    WHEN 'DELETE' THEN ARRAY[OLD.academic_year_id]
    ELSE ARRAY[OLD.academic_year_id, NEW.academic_year_id]
  END;
  IF EXISTS (SELECT 1 FROM academic_years WHERE id = ANY (year_ids) AND status = 'archived') THEN
    RAISE EXCEPTION 'Année archivée : lecture seule' USING ERRCODE = 'GS001';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER periods_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON periods
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user;
