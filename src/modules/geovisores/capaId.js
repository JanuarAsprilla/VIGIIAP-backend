// Un identificador de capa es exactamente «workspace:nombre». Con comas o espacios GeoServer lo interpreta como
// varias capas (typeNames/layer aceptan listas) y el permiso, que solo mira el primer workspace, no cubre las demás.
const PATRON_CAPA_ID = /^[^\s,:]+:[^\s,:]+$/;

export function esCapaIdValido(capaId) {
  return typeof capaId === 'string' && PATRON_CAPA_ID.test(capaId);
}

/** Devuelve el capaId sin cambios o lanza 400 si no cumple `workspace:nombre`. */
export function validarCapaId(capaId) {
  if (!esCapaIdValido(capaId)) {
    throw Object.assign(new Error('Identificador de capa inválido: debe tener la forma workspace:nombre'), {
      status: 400,
      code: 'CAPA_ID_INVALIDO',
    });
  }
  return capaId;
}
