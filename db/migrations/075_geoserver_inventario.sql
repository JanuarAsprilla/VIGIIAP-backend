-- 075: inventario sincronizado de GeoServer (espacios de trabajo, capas, grupos de capas y estilos).
-- Hasta ahora el catálogo se descubría en vivo y solo se guardaba la primera vez que se vio cada capa (057). Aquí queda una
-- copia de lo que GeoServer publica, con estado «actualizado hace X», para enriquecer el catálogo con títulos reales y ofrecer
-- los grupos de capas. Lo que desaparece de GeoServer se marca con eliminado_en (no se borra la fila). La regla de qué capas
-- ve cada visor NO cambia: el inventario es aditivo. Reversión: db/rollback/075_geoserver_inventario.down.sql.
CREATE TABLE geoserver_inventario_espacios (
  conexion_id       UUID        NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  nombre            TEXT        NOT NULL,
  namespace_uri     TEXT,
  titulo_servicio   TEXT,
  resumen_servicio  TEXT,
  aislado           BOOLEAN     NOT NULL DEFAULT false,
  primera_vez_visto TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez_visto  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_en      TIMESTAMPTZ,
  PRIMARY KEY (conexion_id, nombre)
);

CREATE TABLE geoserver_inventario_capas (
  conexion_id       UUID        NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  capa_id           TEXT        NOT NULL,
  espacio           TEXT        NOT NULL,
  nombre            TEXT        NOT NULL,
  titulo            TEXT,
  resumen           TEXT,
  palabras_clave    TEXT[]      NOT NULL DEFAULT '{}',
  tipo              TEXT        NOT NULL CHECK (tipo IN ('vectorial', 'raster')),
  estilo_defecto    TEXT,
  estilos           TEXT[]      NOT NULL DEFAULT '{}',
  bbox              JSONB,
  crs               TEXT[]      NOT NULL DEFAULT '{}',
  almacen           TEXT,
  habilitada        BOOLEAN     NOT NULL DEFAULT true,
  primera_vez_visto TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez_visto  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_en      TIMESTAMPTZ,
  PRIMARY KEY (conexion_id, capa_id)
);
CREATE INDEX idx_geoserver_inventario_capas_espacio ON geoserver_inventario_capas (conexion_id, espacio);

-- miembros: lista ordenada de {tipo: 'capa' | 'grupo', id}.
CREATE TABLE geoserver_inventario_grupos (
  conexion_id       UUID        NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  grupo_id          TEXT        NOT NULL,
  espacio           TEXT,
  nombre            TEXT        NOT NULL,
  titulo            TEXT,
  resumen           TEXT,
  modo              TEXT,
  miembros          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  bbox              JSONB,
  primera_vez_visto TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez_visto  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_en      TIMESTAMPTZ,
  PRIMARY KEY (conexion_id, grupo_id)
);
CREATE INDEX idx_geoserver_inventario_grupos_espacio ON geoserver_inventario_grupos (conexion_id, espacio);

CREATE TABLE geoserver_inventario_estilos (
  conexion_id       UUID        NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  estilo_id         TEXT        NOT NULL,
  nombre            TEXT        NOT NULL,
  espacio           TEXT,
  formato           TEXT,
  primera_vez_visto TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez_visto  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_en      TIMESTAMPTZ,
  PRIMARY KEY (conexion_id, estilo_id)
);

CREATE TABLE geoserver_sincronizaciones (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conexion_id   UUID        NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  iniciada_en   TIMESTAMPTZ NOT NULL,
  terminada_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado        TEXT        NOT NULL CHECK (estado IN ('ok', 'parcial', 'error')),
  fuente        TEXT        NOT NULL CHECK (fuente IN ('rest+ogc', 'ogc')),
  origen        TEXT        NOT NULL DEFAULT 'planificador',
  resumen       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT
);
CREATE INDEX idx_geoserver_sincronizaciones_conexion ON geoserver_sincronizaciones (conexion_id, terminada_en DESC);

-- Mismo patrón que el resto de las tablas: solo el servicio accede, nunca PostgREST directo.
ALTER TABLE geoserver_inventario_espacios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON geoserver_inventario_espacios
  TO service_role USING (true) WITH CHECK (true);
ALTER TABLE geoserver_inventario_capas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON geoserver_inventario_capas
  TO service_role USING (true) WITH CHECK (true);
ALTER TABLE geoserver_inventario_grupos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON geoserver_inventario_grupos
  TO service_role USING (true) WITH CHECK (true);
ALTER TABLE geoserver_inventario_estilos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON geoserver_inventario_estilos
  TO service_role USING (true) WITH CHECK (true);
ALTER TABLE geoserver_sincronizaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON geoserver_sincronizaciones
  TO service_role USING (true) WITH CHECK (true);
