-- ─── Corrige el remitente semilla al dominio real (.org.co, no .gov.co) ──────
-- La migración 029 sembró mail_remitente con el dominio viejo, antes de la
-- corrección de dominio de esta plataforma. Solo actualiza si nadie lo ha
-- cambiado ya manualmente desde el panel (mismo valor exacto de la semilla).

UPDATE configuracion
SET valor = 'notificaciones@iiap.org.co', actualizado_en = NOW()
WHERE clave = 'mail_remitente' AND valor = 'notificaciones@iiap.gov.co';
