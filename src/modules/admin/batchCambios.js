/**
 * Cambios por cuenta de una operación en lote, para el registro de auditoría:
 * { <usuario_id>: { antes, despues } } con el rol o el estado activo según la acción.
 */
export function cambiosDeLote(targets, accion, rol) {
  const campo = accion === 'cambiar-rol' ? 'rol' : 'activo';
  const despues = accion === 'cambiar-rol' ? rol : accion === 'activar';
  return Object.fromEntries(targets.map((t) => [t.id, { antes: t[campo] ?? null, despues }]));
}
