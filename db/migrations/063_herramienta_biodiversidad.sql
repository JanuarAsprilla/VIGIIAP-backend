-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Catálogo de herramientas: registra «Observatorio de Biodiversidad» (APAGADA)
-- ─────────────────────────────────────────────────────────────────────────────
-- La fila es el interruptor único de la herramienta: la API (/api/biodiversidad) responde 404
-- al público mientras `activa = false`; admin_sig/super_admin pueden probarla igual. Se enciende
-- desde el panel de Herramientas cuando los datos estén cargados y validados.
-- Si ya existe (la creó un administrador), se respeta su contenido y su estado.

INSERT INTO herramientas (clave, titulo, descripcion, tag, activa, orden)
VALUES (
  'biodiversidad',
  'Observatorio de Biodiversidad',
  'Registros de especies del Chocó biogeográfico (GBIF) cruzados con listas nacionales de amenaza, endemismo e invasoras. Los conteos reflejan documentación disponible, no abundancia.',
  'Biodiversidad',
  false,
  COALESCE((SELECT MAX(orden) + 1 FROM herramientas WHERE deleted_at IS NULL), 0)
)
ON CONFLICT (clave) DO NOTHING;
