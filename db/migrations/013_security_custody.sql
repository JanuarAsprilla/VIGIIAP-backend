-- ============================================================
-- 013_security_custody.sql
-- Seguridad de archivos y cadena de custodia geoespacial
-- VIGIIAP — IIAP Colombia
-- ============================================================

-- ─── Tabla: file_scan_log ─────────────────────────────────────
-- Registro de cada archivo subido: hash SHA-256, MIME, tamaño
-- y resultado del escaneo de seguridad. Permite detectar
-- duplicados exactos y archivos sospechosos.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_scan_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo_key    TEXT        NOT NULL,
  sha256_hash    CHAR(64)    NOT NULL,
  mime_type      TEXT,
  tamano_bytes   BIGINT,
  uploaded_by    UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  ip_origen      INET,
  resultado      TEXT        NOT NULL DEFAULT 'clean'
                             CHECK (resultado IN ('clean', 'rejected', 'suspicious')),
  detalle        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fsl_hash_idx    ON file_scan_log(sha256_hash);
CREATE INDEX IF NOT EXISTS fsl_uploader    ON file_scan_log(uploaded_by);
CREATE INDEX IF NOT EXISTS fsl_resultado   ON file_scan_log(resultado);
CREATE INDEX IF NOT EXISTS fsl_created_at  ON file_scan_log(created_at DESC);

COMMENT ON TABLE file_scan_log IS
  'Registro de integridad y seguridad de archivos subidos a R2. '
  'Guarda el hash SHA-256 para detectar duplicados y archivos maliciosos.';

-- ─── Tabla: geo_custodia ──────────────────────────────────────
-- Cadena de custodia de cada recurso geoespacial/documental:
-- quién lo creó, editó, publicó, descargó o eliminó y desde qué IP.
-- Cumple con los requisitos de trazabilidad del CONPES 3975
-- y los estándares ISO 19115 de metadatos geográficos.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_custodia (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_recurso   TEXT        NOT NULL
                             CHECK (tipo_recurso IN ('mapa', 'documento')),
  recurso_id     UUID        NOT NULL,
  accion         TEXT        NOT NULL
                             CHECK (accion IN (
                               'ingreso', 'actualizacion', 'publicacion',
                               'despublicacion', 'descarga', 'eliminacion'
                             )),
  usuario_id     UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_email  TEXT,
  ip             INET,
  metadatos      JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gc_recurso_idx  ON geo_custodia(tipo_recurso, recurso_id);
CREATE INDEX IF NOT EXISTS gc_usuario_idx  ON geo_custodia(usuario_id);
CREATE INDEX IF NOT EXISTS gc_accion_idx   ON geo_custodia(accion);
CREATE INDEX IF NOT EXISTS gc_created_at   ON geo_custodia(created_at DESC);

COMMENT ON TABLE geo_custodia IS
  'Cadena de custodia completa de los recursos geoespaciales y documentales. '
  'Registra cada evento del ciclo de vida del dato para trazabilidad institucional.';

-- ─── Tabla: descarga_log ──────────────────────────────────────
-- Log de descargas: qué archivo descargó quién, cuándo y desde dónde.
-- Permite auditar el uso de la información pública y restringida.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS descarga_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_recurso     TEXT        NOT NULL
                               CHECK (tipo_recurso IN ('mapa', 'documento')),
  recurso_id       UUID        NOT NULL,
  recurso_titulo   TEXT,
  usuario_id       UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_email    TEXT,
  ip               INET,
  archivo_url      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dl_recurso_idx  ON descarga_log(tipo_recurso, recurso_id);
CREATE INDEX IF NOT EXISTS dl_usuario_idx  ON descarga_log(usuario_id);
CREATE INDEX IF NOT EXISTS dl_created_at   ON descarga_log(created_at DESC);

COMMENT ON TABLE descarga_log IS
  'Log de descargas de archivos cartográficos y documentales. '
  'Permite medir el uso y auditar el acceso a la información del IIAP.';

-- ─── Vista: cadena de custodia enriquecida ────────────────────
CREATE OR REPLACE VIEW v_cadena_custodia AS
SELECT
  c.id,
  c.tipo_recurso,
  c.recurso_id,
  c.accion,
  c.usuario_email,
  c.ip,
  c.metadatos,
  c.created_at,
  CASE c.tipo_recurso
    WHEN 'mapa'      THEN m.titulo
    WHEN 'documento' THEN d.titulo
  END AS recurso_titulo
FROM geo_custodia c
LEFT JOIN mapas      m ON c.tipo_recurso = 'mapa'      AND m.id = c.recurso_id
LEFT JOIN documentos d ON c.tipo_recurso = 'documento' AND d.id = c.recurso_id
ORDER BY c.created_at DESC;

COMMENT ON VIEW v_cadena_custodia IS
  'Vista que cruza geo_custodia con el título del recurso correspondiente '
  'para uso en el panel administrativo de auditoría.';

-- ─── Vista: estadísticas de descargas por recurso ────────────
CREATE OR REPLACE VIEW v_descargas_stats AS
SELECT
  tipo_recurso,
  recurso_id,
  recurso_titulo,
  COUNT(*)                                           AS total_descargas,
  COUNT(DISTINCT COALESCE(usuario_email, ip::text))  AS usuarios_unicos,
  MAX(created_at)                                    AS ultima_descarga
FROM descarga_log
GROUP BY tipo_recurso, recurso_id, recurso_titulo;

COMMENT ON VIEW v_descargas_stats IS
  'Agrega el total de descargas y usuarios únicos por recurso.';
