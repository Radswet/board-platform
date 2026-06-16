-- ════════════════════════════════════════════════════════════════════
--  MIGRACIÓN — Sección Experimentos
--  Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════════

-- 1. Tabla de sesiones (una sesión = un JSON del rx_ook_hsv.py)
CREATE TABLE IF NOT EXISTS sesiones (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  filename        TEXT,

  -- Metadata de la sesión
  distancia_cm    INTEGER,
  iluminancia_lux REAL,
  brillo_tx_pct   INTEGER,
  bit_ms          INTEGER,
  actual_fps      REAL,
  frames_per_bit  INTEGER,
  tx              TEXT,
  rx              TEXT,
  condicion_luz   TEXT,
  expected_bits   TEXT,
  n_bits          INTEGER,
  n_preambles     INTEGER,

  -- BER calculado automáticamente al subir
  ber_mv          REAL,   -- BER mayoría de votos
  ber_M           REAL,
  ber_C           REAL,
  ber_Y           REAL,
  ber_R           REAL,

  -- Datos completos (para graficar en la web)
  data            JSONB,

  -- Cámara (P5-A)
  cam_exposure_us INTEGER, -- exposure_time_absolute al inicio de sesión (µs)
  cam_gain        INTEGER, -- gain al inicio de sesión
  aec_locked      BOOLEAN DEFAULT FALSE,

  -- Sesión
  n_sequences     INTEGER, -- cuántas secuencias se transmitieron

  -- Campos opcionales para organizar
  etiqueta        TEXT,    -- nombre corto para identificar la sesión
  notas           TEXT
);

ALTER TABLE sesiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sesiones_select" ON sesiones FOR SELECT TO authenticated USING (true);
CREATE POLICY "sesiones_insert" ON sesiones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sesiones_update" ON sesiones FOR UPDATE TO authenticated USING (true);
CREATE POLICY "sesiones_delete" ON sesiones FOR DELETE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE sesiones;

-- ✅ Listo.
