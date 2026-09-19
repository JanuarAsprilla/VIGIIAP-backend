-- 044: Preferencia de tema (claro/oscuro) persistida por cuenta
-- Ítem 5 del plan de módulos administrables. Hoy el tema vive únicamente en
-- localStorage del navegador (ver ThemeContext.tsx) -- cambia de dispositivo
-- o de navegador y la preferencia se pierde. NULL = sin preferencia guardada
-- (el frontend sigue usando su propio default/localStorage en ese caso).

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema TEXT;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tema_check CHECK (tema IS NULL OR tema IN ('light', 'dark'));

COMMENT ON COLUMN usuarios.tema IS 'Preferencia de tema claro/oscuro -- NULL = sin preferencia guardada en el servidor.';
