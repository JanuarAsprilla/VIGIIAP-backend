-- 019: Almacenamiento seguro de tokens de verificación de email y recuperación de contraseña
-- Anteriormente se almacenaban como hex raw; ahora se guarda SHA-256 del token.
-- Los tokens existentes quedan invalidados (no es posible hashearlos sin el valor original).
-- Los usuarios deberán solicitar un nuevo enlace si tenían uno pendiente.

UPDATE usuarios
SET email_verification_token  = NULL,
    email_verification_expires = NULL
WHERE email_verification_token IS NOT NULL
  AND email_verified = false;

UPDATE usuarios
SET password_reset_token  = NULL,
    password_reset_expires = NULL
WHERE password_reset_token IS NOT NULL;

COMMENT ON COLUMN usuarios.email_verification_token IS
  'SHA-256 (hex) del token enviado al usuario. El token original solo existe en el email.';

COMMENT ON COLUMN usuarios.password_reset_token IS
  'SHA-256 (hex) del token enviado al usuario. El token original solo existe en el email.';
