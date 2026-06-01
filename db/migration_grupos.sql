-- Grupos de experimentos — ejecutar en Supabase SQL Editor
CREATE TABLE IF NOT EXISTS experiment_groups (
  id          TEXT PRIMARY KEY,   -- ej: "exp1_caracterizacion"
  title       TEXT,
  description TEXT,               -- condiciones, setup, notas
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE experiment_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "groups_select" ON experiment_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "groups_insert" ON experiment_groups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "groups_update" ON experiment_groups FOR UPDATE TO authenticated USING (true);
