-- ───────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Catálogo de herramientas: publica el Validador de Coordenadas y retira el Conversor
-- ─────────────────────────────────────────────────────────────────────────────
-- El componente del Validador ya viaja en el frontend (registro estático), pero el catálogo es
-- administrable y solo tenía 'conversor' y 'panel-choco' (ver 049_herramientas.sql): sin una fila
-- con su clave la herramienta no aparece. El Validador reemplaza al Conversor (además convierte
-- coordenadas planas MAGNA/UTM), así que el Conversor se retira con borrado lógico (recuperable
-- poniendo deleted_at en NULL).

-- Si un administrador ya la creó a mano, se respeta su contenido.
INSERT INTO herramientas (clave, titulo, descripcion, tag, orden) VALUES
  ('validador-coordenadas', 'Validador de Coordenadas',
   'Valida cada punto de un Excel o CSV contra los límites de los 93 municipios del Chocó Biogeográfico: detecta coordenadas fuera del territorio, invertidas o repetidas y municipios que no coinciden, y exporta el resultado.',
   'Calidad de datos', 1)
ON CONFLICT (clave) DO NOTHING;

-- Retiro del Conversor (reemplazado por el Validador).
UPDATE herramientas
   SET deleted_at = NOW(), activa = false, actualizado_en = NOW()
 WHERE clave = 'conversor' AND deleted_at IS NULL;

-- El Panel Chocó ahora tiene 9 capas (se agregó Manglares). Solo se actualiza si la descripción
-- sigue siendo la sembrada: no se pisa un texto que un administrador haya editado.
UPDATE herramientas
   SET descripcion = 'Titulación colectiva, cuencas, RUNAP, humedales, manglares, páramos, ciénagas y población del Chocó Biogeográfico — 9 capas con gráficas y tablas por departamento.',
       orden = 0,
       actualizado_en = NOW()
 WHERE clave = 'panel-choco' AND descripcion LIKE '%8 secciones%';
