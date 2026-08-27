CREATE TABLE IF NOT EXISTS municipality_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS municipality_lists_name_unique_idx
  ON municipality_lists (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS municipality_list_members (
  list_id uuid NOT NULL REFERENCES municipality_lists(id) ON DELETE CASCADE,
  administrative_area_id uuid NOT NULL REFERENCES administrative_areas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, administrative_area_id)
);

CREATE INDEX IF NOT EXISTS municipality_list_members_area_idx
  ON municipality_list_members (administrative_area_id, list_id);
