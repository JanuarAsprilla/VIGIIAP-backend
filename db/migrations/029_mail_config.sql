-- ─── Configuración de correo remitente editable desde el panel admin ────────
-- Permite al super_admin cambiar el nombre y dirección "From" de los emails
-- sin necesidad de modificar variables de entorno ni redesplegar el servicio.
-- La dirección MAIL_USER (autenticación SMTP) sigue viniendo del env var;
-- mail_remitente sobreescribe solo el campo "From:" visible al destinatario.

INSERT INTO configuracion (clave, valor) VALUES
  ('mail_remitente',       'notificaciones@iiap.gov.co'),
  ('mail_remitente_nombre','VIGIIAP — IIAP')
ON CONFLICT (clave) DO NOTHING;
