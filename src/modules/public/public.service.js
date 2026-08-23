/**
 * VIGIIAP — Public Service
 * Datos de solo lectura expuestos sin autenticación. Nunca reutilizar
 * adminService.getConfiguracion() aquí: esta consulta restringe a nivel de
 * SQL las claves devueltas, para que un futuro cambio en la tabla
 * `configuracion` (ej. credenciales de correo, mensajes internos de
 * mantenimiento) no pueda filtrarse por accidente a través de este endpoint.
 */
import { query } from '../../config/database.js';

// Whitelist de claves seguras para exponer públicamente. Cualquier clave
// nueva en CONFIG_SCHEMA (src/modules/admin/admin.controller.js) permanece
// privada por defecto — hay que agregarla aquí explícitamente.
const PUBLIC_CONFIG_KEYS = ['politicaPrivacidad', 'siteName', 'siteDesc'];

/** Lee únicamente las claves de configuración whitelisteadas como públicas. */
export async function getConfiguracionPublica() {
  const { rows } = await query(
    'SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])',
    [PUBLIC_CONFIG_KEYS],
  );
  const found = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));

  return {
    politicaPrivacidad: found.politicaPrivacidad ?? null,
    siteName:           found.siteName ?? null,
    siteDesc:           found.siteDesc ?? null,
  };
}
