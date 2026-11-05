import { query } from '../../config/database.js';

/** Versión vigente de la política de tratamiento de datos que se le muestra a la persona. */
export const VERSION_POLITICA = process.env.POLITICA_VERSION || '1.0';

export const TIPOS_CONSENTIMIENTO = Object.freeze(['tratamiento_datos', 'terminos', 'analitica_persistente', 'datos_sensibles']);
export const ORIGENES_CONSENTIMIENTO = Object.freeze(['registro', 'oauth', 'visitante', 'perfil', 'banner']);

const IP_VALIDA = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Guarda la prueba de una aceptación (o revocación, con `aceptado: false`). Nunca actualiza filas:
 * cada decisión es un registro nuevo, así el historial queda completo.
 */
export async function registrarConsentimiento({ usuarioId, tipo, origen, aceptado = true, ip, userAgent }) {
  if (!TIPOS_CONSENTIMIENTO.includes(tipo)) throw new Error(`Tipo de consentimiento desconocido: ${tipo}`);
  if (!ORIGENES_CONSENTIMIENTO.includes(origen)) throw new Error(`Origen de consentimiento desconocido: ${origen}`);

  const { rows } = await query(
    `INSERT INTO consentimientos (usuario_id, tipo, version_politica, origen, aceptado, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, creado_en`,
    [
      usuarioId ?? null,
      tipo,
      VERSION_POLITICA,
      origen,
      Boolean(aceptado),
      typeof ip === 'string' && IP_VALIDA.test(ip) ? ip : null,
      userAgent ? String(userAgent).slice(0, 300) : null,
    ],
  );
  return rows[0];
}

/** Historial de decisiones de una persona, de la más reciente a la más antigua. */
export async function listarConsentimientos(usuarioId) {
  const { rows } = await query(
    `SELECT tipo, version_politica, origen, aceptado, ip, creado_en
     FROM consentimientos WHERE usuario_id = $1 ORDER BY creado_en DESC`,
    [usuarioId],
  );
  return rows;
}
