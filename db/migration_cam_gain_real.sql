-- Fix: cam_gain pasa de INTEGER a REAL
-- picamera2 entrega AnalogueGain fraccionario (ej. 3.375) → no cabe en integer.
-- Ejecutar en Supabase Dashboard → SQL Editor.

ALTER TABLE sesiones ALTER COLUMN cam_gain TYPE REAL USING cam_gain::real;
