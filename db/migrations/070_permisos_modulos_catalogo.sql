-- 070: el catálogo de módulos delegables del código (modulos.service.js) incluye 'biodiversidad_datos' y 'custodia',
-- pero el CHECK de admin_permisos_modulo (migración 049) solo permitía 12 módulos: asignar cualquiera de esos dos a un
-- administrador fallaba con «violates check constraint admin_permisos_modulo_modulo_check» (500).
ALTER TABLE admin_permisos_modulo DROP CONSTRAINT IF EXISTS admin_permisos_modulo_modulo_check;
ALTER TABLE admin_permisos_modulo ADD CONSTRAINT admin_permisos_modulo_modulo_check CHECK (modulo IN (
  'usuarios', 'solicitudes', 'documentos', 'mapas',
  'geovisores', 'conexiones_geoserver', 'categorias',
  'herramientas', 'biodiversidad_datos',
  'configuracion', 'actividad', 'errores', 'reportes', 'custodia'
));
