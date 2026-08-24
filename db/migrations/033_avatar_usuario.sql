-- 033: Foto de perfil (avatar) por usuario
-- Habilita el botón de cámara en Mi Perfil, que hasta ahora era decorativo.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN usuarios.avatar_url IS
  'URL pública (bucket R2) de la foto de perfil del usuario. NULL si no ha subido una — el frontend usa iniciales como respaldo.';
