-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Migración 003: Auditoría y trazabilidad
-- Tabla audit_log: registro de todas las acciones importantes
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Audit log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  accion       VARCHAR(100) NOT NULL,     -- 'login', 'registro', 'create_usuario', 'update_solicitud', etc.
  modulo       VARCHAR(50)  NOT NULL,     -- 'auth', 'usuarios', 'solicitudes', 'mapas', etc.
  entidad_id   TEXT,                      -- ID del recurso afectado (opcional)
  descripcion  TEXT,                      -- Descripción legible de la acción
  usuario_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_email VARCHAR(255),             -- Copia del email para trazabilidad post-eliminación
  ip           VARCHAR(45),              -- IP del cliente
  user_agent   TEXT,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_usuario_id ON audit_log(usuario_id);
CREATE INDEX idx_audit_log_accion     ON audit_log(accion);
CREATE INDEX idx_audit_log_modulo     ON audit_log(modulo);
CREATE INDEX idx_audit_log_creado_en  ON audit_log(creado_en DESC);

-- ─── Visitantes (registro de accesos públicos) ────────────────────────────────
CREATE TABLE IF NOT EXISTS visitantes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(150),               -- Nombre opcional
  tipo        VARCHAR(50) DEFAULT 'externo',  -- 'externo', 'anonimo'
  ip          VARCHAR(45),
  user_agent  TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visitantes_creado_en ON visitantes(creado_en DESC);

-- ─── Enum para tipo acceso de visitante ──────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo_acceso VARCHAR(30) DEFAULT 'institucional';
-- Valores: 'institucional' (pertenece al IIAP/institución), 'externo' (usuario externo con registro)
COMMENT ON COLUMN usuarios.tipo_acceso IS 'institucional = pertenece al IIAP o institución aliada; externo = registrado desde fuera';
