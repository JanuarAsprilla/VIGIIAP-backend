-- 035: Login con proveedores externos (Google, Microsoft — Apple queda para
-- cuando el instituto tenga cuenta de Apple Developer Program, ver
-- src/modules/oauth/oauth.providers.js).
--
-- password_hash pasa a nullable: una cuenta creada por OAuth no tiene
-- contraseña propia hasta que la persona configure una manualmente (fuera de
-- alcance por ahora). login() en auth.service.js ya rechaza el intento de
-- login por contraseña en cuentas sin password_hash.

ALTER TABLE usuarios ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS oauth_id       VARCHAR(255);

-- perfil_completo=false marca una cuenta OAuth recién creada sin institución
-- — el frontend muestra una alerta para completarlo (ver
-- PATCH /api/v1/auth/completar-perfil). Las cuentas por registro tradicional
-- ya piden institución en el formulario, así que nacen completas.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_completo BOOLEAN NOT NULL DEFAULT true;

-- Único por proveedor — evita que dos usuarios se disputen el mismo ID
-- externo. Parcial (WHERE oauth_provider IS NOT NULL) porque las cuentas
-- tradicionales no tienen valor aquí y NULL,NULL no debe chocar entre ellas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_oauth
  ON usuarios (oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL;

COMMENT ON COLUMN usuarios.oauth_provider IS 'google | microsoft | apple — NULL si la cuenta usa contraseña propia.';
COMMENT ON COLUMN usuarios.oauth_id       IS 'ID de cuenta estable en el proveedor externo (sub de Google/Microsoft).';
COMMENT ON COLUMN usuarios.perfil_completo IS 'false tras un primer login OAuth sin institución — dispara la alerta de completar perfil.';
