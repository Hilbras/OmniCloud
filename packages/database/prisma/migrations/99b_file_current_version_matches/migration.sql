-- A file's currentVersionId must name a version of that same file. The foreign
-- key only proves the version exists; it does not stop a file pointing at
-- another file's version. Keep the invariant in the database, not only in the
-- service layer.
CREATE OR REPLACE FUNCTION "check_file_current_version"()
RETURNS trigger AS $$
BEGIN
  IF NEW."currentVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FileVersion" v
     WHERE v."id" = NEW."currentVersionId" AND v."fileId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'File.currentVersionId must belong to the same file';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "File_currentVersionId_same_file"
  AFTER INSERT OR UPDATE OF "currentVersionId" ON "File"
  FOR EACH ROW EXECUTE FUNCTION "check_file_current_version"();
