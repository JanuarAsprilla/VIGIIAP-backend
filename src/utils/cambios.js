/**
 * Diferencias "antes → después" para el registro de auditoría.
 * Solo se incluyen los campos que cambiaron, los que parecen secretos se ocultan y los valores
 * largos se recortan: el registro debe poder consultarse sin convertirse en un volcado de datos.
 */

const OCULTO = '[oculto]';
const MAX_TEXTO = 200;
const MAX_CAMPOS = 40;

// Nombres de campo que nunca deben quedar en claro.
const SECRETO = /pass|secret|token|key|clave|credencial|credential|contrase|auth|hash|totp|authorization/i;

function normalizar(valor) {
  if (valor === undefined) return null;
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'number') return valor;
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  return texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO)}…` : texto;
}

function iguales(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * @param {object} antes   estado anterior
 * @param {object} despues estado nuevo
 * @param {string[]} [campos] limitar la comparación a estos campos (por defecto, los de `despues`)
 * @returns {object|null} { campo: { antes, despues } } o null si nada cambió
 */
export function diffCambios(antes, despues, campos) {
  const origen = antes ?? {};
  const destino = despues ?? {};
  const claves = (campos ?? Object.keys(destino)).slice(0, MAX_CAMPOS);

  const cambios = {};
  for (const campo of claves) {
    if (iguales(origen[campo], destino[campo])) continue;
    cambios[campo] = SECRETO.test(campo)
      ? { antes: OCULTO, despues: OCULTO }
      : { antes: normalizar(origen[campo]), despues: normalizar(destino[campo]) };
  }
  return Object.keys(cambios).length ? cambios : null;
}
