// Vive aparte de admin.service.js para no crear un ciclo con auth.service.js
// (admin.service ya importa de ahí para revokeAllRefreshTokens).
import { query } from '../config/database.js';

// Estos dos ya se enviaban sin condición, así que si la clave no existe en BD
// se asume habilitado. loginNotifs es nuevo y arranca apagado.
const DEFAULT_ON = new Set(['emailNotifs', 'solicitudNotifs']);

export async function notificacionHabilitada(clave) {
  const { rows } = await query(
    "SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])",
    [['emailNotifs', clave]]
  );
  const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));

  const masterOn = cfg.emailNotifs === undefined || cfg.emailNotifs === 'true';
  if (clave === 'emailNotifs') return masterOn;

  const defaultOn  = DEFAULT_ON.has(clave);
  const specificOn = cfg[clave] === undefined ? defaultOn : cfg[clave] === 'true';
  return masterOn && specificOn;
}
