-- 046: Preferencias de notificación por usuario (Fase 3 del plan de módulos)
-- Sin fila = preferencia por defecto (recibir), igual que usuarios.tema en
-- la migración 044 -- silenciar un tipo es la excepción explícita, no el
-- estado inicial. Solo cubre el canal "en pantalla" (in-app); el canal
-- "por correo" se deja fuera a propósito: los envíos de correo actuales
-- (mailer.js) van a listas de admins resueltas aparte de esta tabla y
-- conectarlos es un cambio más grande, no una columna sin uso.

CREATE TABLE IF NOT EXISTS usuario_notificacion_prefs (
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo_clave  TEXT NOT NULL REFERENCES tipos_notificacion(clave) ON DELETE CASCADE,
  en_pantalla BOOLEAN NOT NULL DEFAULT true,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, tipo_clave)
);

COMMENT ON TABLE usuario_notificacion_prefs IS 'Preferencia por usuario y tipo -- sin fila = recibir (default). en_pantalla=false silencia ese tipo para esa cuenta.';
