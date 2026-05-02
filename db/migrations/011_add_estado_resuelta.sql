-- 011_add_estado_resuelta.sql
-- Agrega el estado 'resuelta' (solicitud tramitada con respuesta formal)
-- y el campo respondida_en para registrar el momento de la respuesta.

ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'resuelta';

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS respondida_en TIMESTAMPTZ;
