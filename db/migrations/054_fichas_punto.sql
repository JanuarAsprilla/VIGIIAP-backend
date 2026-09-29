-- 054: Fichas por punto en geovisores -- contenido curado (foto/video/
-- descripción) por punto o polígono de una capa vectorial de GeoServer.
--
-- Decisión clave: el identificador estable de cada feature NO es el fid
-- interno de GeoServer (se reasigna si el IIAP reimporta los datos,
-- huerfanizando todo el contenido cargado) sino un atributo real de la capa
-- que el administrador designa (campo_identificador). La configuración vive
-- a nivel de CAPA (conexion_geoserver_id + capa_id), no por geovisor -- así,
-- si dos geovisores muestran la misma capa, comparten las mismas fichas en
-- vez de duplicar la carga de trabajo.
--
-- fichas_punto_medios se crea completa en esta migración (incluida la
-- columna `estado` para el video asíncrono) aunque los endpoints de subida
-- todavía no existen -- el esquema ya está cerrado con el frontend
-- (ver plan "Fichas por punto en geovisores"), evita una migración de
-- retrofit cuando se implemente la subida.

CREATE TABLE capas_fichas_config (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conexion_geoserver_id  UUID NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  capa_id                TEXT NOT NULL,
  campo_identificador    TEXT NOT NULL,
  campo_etiqueta         TEXT,
  creado_por             UUID REFERENCES usuarios(id),
  creado_en              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conexion_geoserver_id, capa_id)
);

CREATE TABLE fichas_punto (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE RESTRICT: borrar una config con fichas creadas sería perder
  -- contenido curado por accidente -- hay que borrar las fichas explícitamente
  -- primero (o nunca, ver plan: la config no tiene endpoint de borrado).
  capa_config_id      UUID NOT NULL REFERENCES capas_fichas_config(id) ON DELETE RESTRICT,
  valor_identificador TEXT NOT NULL,
  titulo              TEXT,
  descripcion         TEXT NOT NULL DEFAULT '',
  creado_por          UUID REFERENCES usuarios(id),
  actualizado_por     UUID REFERENCES usuarios(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (capa_config_id, valor_identificador),
  CHECK (length(valor_identificador) BETWEEN 1 AND 255),
  CHECK (length(descripcion) <= 10000)
);

CREATE TABLE fichas_punto_medios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id      UUID NOT NULL REFERENCES fichas_punto(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('imagen', 'video')),
  -- 'listo' de inmediato para imagen (recompresión síncrona con sharp);
  -- 'procesando' al crear el registro de un video (transcodificación en
  -- segundo plano con ffmpeg, todavía no implementada); 'error' si falla.
  estado        TEXT NOT NULL DEFAULT 'listo' CHECK (estado IN ('listo', 'procesando', 'error')),
  object_key    TEXT,   -- NULL mientras estado='procesando'
  miniatura_key TEXT,
  mime          TEXT,
  bytes         BIGINT,
  ancho         INTEGER,
  alto          INTEGER,
  duracion_s    NUMERIC(8, 2),
  leyenda       TEXT CHECK (length(leyenda) <= 300),
  creditos      TEXT CHECK (length(creditos) <= 200),
  orden         INTEGER NOT NULL DEFAULT 0,
  creado_por    UUID REFERENCES usuarios(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX fichas_punto_capa_config_id_idx ON fichas_punto(capa_config_id);
CREATE INDEX fichas_punto_medios_ficha_id_idx ON fichas_punto_medios(ficha_id);

-- Mismo patrón que 037_geovisores.sql: la API conecta como el rol de
-- servicio (bypassa RLS), esto solo bloquea el acceso público vía PostgREST.
ALTER TABLE capas_fichas_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichas_punto        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichas_punto_medios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON capas_fichas_config
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role full access" ON fichas_punto
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role full access" ON fichas_punto_medios
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN capas_fichas_config.campo_identificador IS
  'Atributo real de la capa en GeoServer usado como identificador estable de cada feature -- nunca el fid interno, que se reasigna al reimportar datos.';
COMMENT ON COLUMN fichas_punto.valor_identificador IS
  'Valor del campo_identificador de la config, siempre como texto (String(v).trim()).';
COMMENT ON COLUMN fichas_punto_medios.estado IS
  'listo=visible en el visor público; procesando=video en transcodificación, url no disponible todavía; error=transcodificación falló.';
