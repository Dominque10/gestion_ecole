-- Annonces (4e) : isolation entre écoles (RLS), lecture seule des années archivées ; un parent ne lit
-- que les annonces qui concernent l'un de ses enfants (école, niveau ou classe de l'année) et n'écrit rien.

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY announcements_tenant ON announcements FOR ALL
  USING (school_id = app.current_school_id())
  WITH CHECK (school_id = app.current_school_id());
REVOKE DELETE ON announcements FROM app_user;

CREATE TRIGGER announcements_archived_year
  BEFORE INSERT OR UPDATE OR DELETE ON announcements
  FOR EACH ROW EXECUTE FUNCTION app.forbid_write_in_archived_year();

CREATE POLICY announcements_parent_read ON announcements AS RESTRICTIVE FOR SELECT
  USING (
    NOT app.current_user_is_parent_only() OR EXISTS (
      SELECT 1 FROM enrollments e
      WHERE e.id IN (SELECT app.parent_enrollment_ids())
        AND e.academic_year_id = announcements.academic_year_id
        AND e.status <> 'left'
        AND (announcements.audience = 'school'
          OR (announcements.audience = 'level' AND e.level_id = announcements.level_id)
          OR (announcements.audience = 'class' AND e.class_id = announcements.class_id))
    )
  );
CREATE POLICY announcements_parent_insert ON announcements AS RESTRICTIVE FOR INSERT
  WITH CHECK (NOT app.current_user_is_parent_only());
CREATE POLICY announcements_parent_update ON announcements AS RESTRICTIVE FOR UPDATE
  USING (NOT app.current_user_is_parent_only());
CREATE POLICY announcements_parent_delete ON announcements AS RESTRICTIVE FOR DELETE
  USING (NOT app.current_user_is_parent_only());
