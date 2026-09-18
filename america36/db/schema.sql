-- América List — banco online (PostgreSQL / Supabase)
-- Execute este script no SQL Editor do seu projeto PostgreSQL.
CREATE TABLE IF NOT EXISTS america_list_state (
  id integer PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION america_list_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS america_list_state_updated_at ON america_list_state;
CREATE TRIGGER america_list_state_updated_at
BEFORE UPDATE ON america_list_state
FOR EACH ROW EXECUTE FUNCTION america_list_touch_updated_at();
