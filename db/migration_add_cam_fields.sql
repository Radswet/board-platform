-- ════════════════════════════════════════════════════════════════════
--  MIGRACIÓN — Agregar campos AEC y n_sequences a tabla sesiones
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS cam_exposure_us INTEGER,  -- exposure_time_absolute al inicio (µs)
  ADD COLUMN IF NOT EXISTS cam_gain        INTEGER,  -- gain al inicio
  ADD COLUMN IF NOT EXISTS aec_locked      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS n_sequences     INTEGER;

-- Marcar sesiones históricas: AEC no fue controlado
UPDATE sesiones
SET aec_locked = FALSE
WHERE aec_locked IS NULL;

-- ✅ Listo. Las sesiones nuevas llenarán cam_exposure_us y cam_gain automáticamente.
-- Las sesiones históricas quedan con aec_locked=FALSE y cam_exposure_us=NULL (no medido).
