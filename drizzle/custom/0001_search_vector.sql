-- Keeps chunks.search_vector in step with chunks.content.
--
-- A trigger rather than a GENERATED column because to_tsvector with an
-- explicit regconfig is not immutable enough for a stored generated column
-- on every Postgres version we support.

CREATE OR REPLACE FUNCTION chunks_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_search_vector_trigger ON chunks;

CREATE TRIGGER chunks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_search_vector_update();

-- Backfill anything inserted before the trigger existed.
UPDATE chunks SET content = content WHERE search_vector IS NULL;
