-- 045: Catálogo de tipos de notificación (Fase 2 del plan de módulos)
-- Antes, el ícono/color/etiqueta de cada tipo de notificación vivía
-- hardcodeado en TYPE_META (NotificacionesPanel.tsx) con dos claves,
-- 'usuario'/'solicitud', que ya no coinciden con los valores reales que usa
-- notificaciones.service.js desde la Fase 1 ('nuevo_usuario',
-- 'nueva_solicitud', 'solicitud_actualizada') -- todo caía silenciosamente
-- en el ícono "General" por defecto. Esta tabla es la fuente única de verdad
-- para esa metadata, editable desde el panel admin sin tocar código ni
-- redesplegar.
--
-- 'aplica_a' filtra qué tipos ve cada persona en sus preferencias
-- (usuario_notificacion_prefs, ver 046) -- un usuario normal no necesita
-- poder silenciar "nuevo_usuario", que nunca le llega.

CREATE TABLE IF NOT EXISTS tipos_notificacion (
  clave     TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  icono     TEXT NOT NULL DEFAULT 'Bell',
  color     TEXT NOT NULL DEFAULT 'gold',
  aplica_a  TEXT NOT NULL DEFAULT 'ambos' CHECK (aplica_a IN ('admin', 'usuario', 'ambos')),
  activo    BOOLEAN NOT NULL DEFAULT true,
  orden     INTEGER NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tipos_notificacion IS 'Catálogo editable de tipos de notificación -- ícono/color/etiqueta/audiencia, gestionable por super_admin.';
COMMENT ON COLUMN tipos_notificacion.clave IS 'Debe coincidir con el valor `tipo` usado al crear la notificación (ver notificaciones.service.js).';
COMMENT ON COLUMN tipos_notificacion.aplica_a IS 'A quién le puede llegar este tipo -- admin, usuario o ambos. Filtra el panel de preferencias.';

-- Seed: los 3 tipos que ya emite el backend desde la Fase 1.
INSERT INTO tipos_notificacion (clave, nombre, icono, color, aplica_a, orden) VALUES
  ('nuevo_usuario',          'Nuevo usuario registrado', 'User',           'magenta', 'admin',   1),
  ('nueva_solicitud',        'Nueva solicitud',          'ClipboardList',  'gold',    'admin',   2),
  ('solicitud_actualizada',  'Solicitud actualizada',    'ClipboardList',  'primary', 'usuario', 3)
ON CONFLICT (clave) DO NOTHING;
