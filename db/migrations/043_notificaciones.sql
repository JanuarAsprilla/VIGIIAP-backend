-- 043: Notificaciones persistentes en BD
-- Reemplaza el panel de notificaciones que hasta ahora se sintetizaba en
-- cada GET a partir de usuarios/solicitudes (ver getNotificaciones() en
-- admin.service.js) y cuyo estado de "leída" vivía solo en localStorage del
-- navegador (por dispositivo, no por cuenta). Con una tabla real:
--   - el estado de lectura es por cuenta, no por navegador;
--   - cualquier usuario puede recibir notificaciones, no solo admins;
--   - un evento (nueva solicitud, cambio de estado, etc.) se registra una
--     vez, en el momento en que ocurre, en vez de recalcularse cada vez que
--     alguien abre el panel.
--
-- Fan-out simple: una notificación "para todos los admins" inserta una fila
-- por cada admin activo en ese momento (ver notificarAdmins() en
-- notificaciones.service.js), en vez de una tabla de lectura compartida —
-- así cada quien marca la suya como leída sin afectar a los demás.

CREATE TABLE IF NOT EXISTS notificaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destinatario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  mensaje         TEXT NOT NULL,
  link            TEXT,
  leido_en        TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_destinatario ON notificaciones (destinatario_id, creado_en DESC);
-- Índice parcial: la consulta más frecuente (contar/listar no leídas) nunca
-- toca las ya leídas, y son la mayoría con el tiempo.
CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas ON notificaciones (destinatario_id) WHERE leido_en IS NULL;

COMMENT ON TABLE notificaciones IS 'Notificaciones por usuario destinatario -- leido_en NULL = no leída.';
COMMENT ON COLUMN notificaciones.tipo IS 'Clave del tipo de evento: nuevo_usuario, nueva_solicitud, solicitud_resuelta, etc.';

-- Backfill: sin esto, el panel viejo (getNotificaciones(), retirado en este
-- mismo cambio) sintetizaba el backlog de usuarios por activar y solicitudes
-- pendientes en cada GET -- al pasar a una tabla que solo registra eventos
-- hacia adelante, ese backlog ya existente desaparecería del panel de golpe.
-- Se inserta una vez, por admin activo en este momento (mismo fan-out que
-- notificarAdmins()).
INSERT INTO notificaciones (destinatario_id, tipo, mensaje, link, creado_en)
SELECT admin.id, 'nuevo_usuario', u.nombre || ' verificó su correo y espera activación', '/admin/usuarios', u.creado_en
FROM usuarios u
CROSS JOIN (SELECT id FROM usuarios WHERE rol IN ('admin_sig', 'super_admin') AND activo = true) admin
WHERE u.activo = false AND u.email_verified = true;

INSERT INTO notificaciones (destinatario_id, tipo, mensaje, link, creado_en)
SELECT admin.id, 'nueva_solicitud',
       COALESCE(sol_u.nombre, 'Usuario') || ' envió una solicitud de tipo "' || s.tipo || '"',
       '/admin/solicitudes', s.creado_en
FROM solicitudes s
LEFT JOIN usuarios sol_u ON sol_u.id = s.usuario_id
CROSS JOIN (SELECT id FROM usuarios WHERE rol IN ('admin_sig', 'super_admin') AND activo = true) admin
WHERE s.estado IN ('pendiente', 'en_revision');
