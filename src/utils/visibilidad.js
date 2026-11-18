/**
 * Visibilidad que un usuario puede ver: lista de valores permitidos, o null si no hay límite.
 * Misma regla que los listados de documentos, mapas y geovisores.
 */
export function visibilidadPermitida(user) {
  if (!user || user.tipo === 'visitante' || user.rol === 'visitante' || user.rol === 'publico') return ['publico'];
  if (['admin_sig', 'super_admin', 'investigador', 'tecnico', 'institucional'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

export function puedeVerVisibilidad(visibilidad, user) {
  const permitida = visibilidadPermitida(user);
  return !permitida || permitida.includes(visibilidad);
}
