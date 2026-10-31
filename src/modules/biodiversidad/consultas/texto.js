const ORIGEN = 'áàäâéèëêíìïîóòöôúùüûñç';
const DESTINO = 'aaaaeeeeiiiioooouuuunc';

/** Expresión SQL que pliega a minúsculas y sin acentos (sin depender de la extensión unaccent). */
export const plegarSql = (columna) => `translate(lower(${columna}), '${ORIGEN}', '${DESTINO}')`;

/**
 * Patrón LIKE para «contiene»: plegado igual que `plegarSql` y con `\`, `%` y `_` escapados, de modo
 * que el texto del usuario nunca actúe como comodín. Se usa SIEMPRE como parámetro (con ESCAPE '\').
 */
export function patronBusqueda(texto) {
  const plegado = texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  return `%${plegado.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
