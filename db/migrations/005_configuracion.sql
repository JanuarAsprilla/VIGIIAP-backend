-- ─── Tabla de configuración del sistema ────────────────────────────────────────
-- Almacena pares clave→valor para ajustes globales del admin.

CREATE TABLE IF NOT EXISTS configuracion (
  clave          TEXT PRIMARY KEY,
  valor          TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Valores por defecto institucionales
INSERT INTO configuracion (clave, valor) VALUES
  ('siteName',            'VIGIIAP'),
  ('siteDesc',            'Visor y Gestor de Información Ambiental del IIAP'),
  ('region',              'Chocó Biogeográfico'),
  ('email',               'info@iiap.org.co'),
  ('phone',               '+57 (4) 671 1767'),
  ('address',             'Calle 14 No. 1-61, Quibdó, Chocó'),
  ('modoMantenimiento',   'false'),
  ('mensajeMantenimiento','El sistema estará en mantenimiento. Disculpe las molestias.')
ON CONFLICT (clave) DO NOTHING;
