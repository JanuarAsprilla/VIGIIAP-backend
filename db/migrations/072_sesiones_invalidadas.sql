-- 072: cierre inmediato de los tokens de acceso de una cuenta.
-- Cambiar o restablecer la contraseña, desactivar la cuenta o cerrar sesión ya revocaban los refresh tokens, pero el token
-- de acceso (15 min) seguía valiendo hasta vencer: quien lo hubiera robado conservaba la sesión ese tiempo. Aquí queda el
-- instante a partir del cual los tokens emitidos antes de él dejan de valer; tokenBlacklist.js lo mantiene también en memoria.
CREATE TABLE sesiones_invalidadas (
  usuario_id         UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  invalidar_antes_de TIMESTAMPTZ NOT NULL
);

-- Mismo patrón que el resto de las tablas: solo el servicio accede, nunca PostgREST directo.
ALTER TABLE sesiones_invalidadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON sesiones_invalidadas
  TO service_role USING (true) WITH CHECK (true);

-- La 071 (informes) olvidó el mismo patrón.
ALTER TABLE informes_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON informes_config
  TO service_role USING (true) WITH CHECK (true);
ALTER TABLE informes_herramienta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON informes_herramienta
  TO service_role USING (true) WITH CHECK (true);
