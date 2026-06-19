-- 023: Password expiry policy para roles institucionales
-- publico y visitante no aplican. Solo admin_sig, investigador, tecnico, institucional.
-- Política por defecto: 90 días. Configurable en tabla configuracion.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ DEFAULT NOW();

-- Clave de configuración (valor por defecto: 90 días)
INSERT INTO configuracion (clave, valor)
VALUES ('passwordExpiryDays', '90')
ON CONFLICT (clave) DO NOTHING;

COMMENT ON COLUMN usuarios.password_changed_at IS
  'Timestamp del último cambio de contraseña. Usado para política de expiración en roles institucionales.';
