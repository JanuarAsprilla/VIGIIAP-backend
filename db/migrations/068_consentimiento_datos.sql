-- Prueba de la autorización para el tratamiento de datos personales (Ley 1581 de 2012, Decreto 1377 de 2013:
-- el responsable debe poder demostrar que obtuvo la autorización del titular).
-- terminos_aceptados_en: instante en que la persona marcó la casilla; terminos_version: huella corta del texto
-- vigente (política de privacidad + términos) en ese momento. NULL = cuenta anterior a este registro.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS terminos_aceptados_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terminos_version VARCHAR(32);

COMMENT ON COLUMN usuarios.terminos_aceptados_en IS 'Cuándo aceptó los términos y el tratamiento de datos (NULL: cuenta previa al registro de consentimiento)';
COMMENT ON COLUMN usuarios.terminos_version IS 'Huella (sha256 truncado) de politicaPrivacidad + terminosUso vigentes al aceptar';
