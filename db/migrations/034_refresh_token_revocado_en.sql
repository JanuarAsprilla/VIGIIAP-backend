-- 034: Timestamp de revocación en refresh_tokens
-- Habilita una ventana de gracia para reuso de tokens: una segunda petición de
-- refresh que llega casi al mismo tiempo que la primera (doble clic, reintento
-- de red, dos pestañas) no debe tratarse como robo de token y matar toda la
-- sesión — solo un reuso mucho después de la rotación es sospechoso de verdad.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revocado_en TIMESTAMPTZ;

COMMENT ON COLUMN refresh_tokens.revocado_en IS
  'Cuándo se revocó este token (rotación normal o revocación total). NULL si sigue activo.';
