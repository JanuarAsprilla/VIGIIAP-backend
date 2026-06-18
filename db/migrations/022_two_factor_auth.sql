-- 022: 2FA TOTP para roles admin
-- Obligatorio para super_admin y admin_sig. Opcional para investigador/institucional.
-- Compatible con Google Authenticator, Authy, 1Password (RFC 6238 TOTP).

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS totp_secret       TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[];

COMMENT ON COLUMN usuarios.totp_secret IS
  'Secret TOTP en base32. Nunca exponer en APIs de listado.';
COMMENT ON COLUMN usuarios.totp_backup_codes IS
  'Hashes bcrypt de 8 códigos de emergencia de un solo uso.';
