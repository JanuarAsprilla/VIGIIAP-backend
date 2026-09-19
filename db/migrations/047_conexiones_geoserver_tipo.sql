-- 047: Conexiones a GeoServer/WMS externos de terceros
-- Hasta ahora toda conexión asumía un GeoServer propio con credenciales de
-- administración -- un WMS público de otra institución normalmente no pide
-- login, pero la tabla exigía usuario/contraseña igual. El descubrimiento de
-- capas ya usa estándares OGC (WFS/WCS GetCapabilities, ver
-- geoserver.connector.js), así que técnicamente ya funciona contra cualquier
-- servidor compatible -- lo único que faltaba era el esquema.

ALTER TABLE conexiones_geoserver ADD COLUMN tipo TEXT NOT NULL DEFAULT 'propio' CHECK (tipo IN ('propio', 'externo'));
ALTER TABLE conexiones_geoserver ALTER COLUMN usuario_lectura DROP NOT NULL;
ALTER TABLE conexiones_geoserver ALTER COLUMN password_cifrado DROP NOT NULL;

-- Invariante real (no solo a nivel de aplicación): una conexión "propia" SIEMPRE
-- exige credenciales; una "externa" puede o no tenerlas. Puesto en la propia BD
-- para que ningún camino de código futuro pueda dejar una conexión "propia" sin
-- login por accidente -- ver errorHandler.js para el mensaje amigable (23514).
ALTER TABLE conexiones_geoserver ADD CONSTRAINT conexiones_geoserver_credenciales_check
  CHECK (tipo = 'externo' OR (usuario_lectura IS NOT NULL AND password_cifrado IS NOT NULL));

COMMENT ON COLUMN conexiones_geoserver.tipo IS 'propio = GeoServer institucional con credenciales de admin; externo = WMS/WFS de terceros, credenciales opcionales.';
