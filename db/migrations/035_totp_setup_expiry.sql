-- 035: Expiración del secret TOTP generado en /auth/2fa/setup
-- El secret se guarda en cuanto se genera el QR, antes de confirmarlo con un
-- código — si la persona deja esa pantalla abierta (o la sesión queda
-- olvidada en un equipo compartido) sin nunca completar la activación, el
-- secret queda válido para siempre en la BD. totp_secret_creado_en marca
-- cuándo se generó; enableTotp() lo rechaza pasado ese plazo y exige volver
-- a pedir un QR nuevo.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secret_creado_en TIMESTAMPTZ;

COMMENT ON COLUMN usuarios.totp_secret_creado_en IS
  'Cuándo se generó el secret TOTP pendiente de confirmar (ver /auth/2fa/setup). NULL una vez activado o si nunca se inició un setup.';
