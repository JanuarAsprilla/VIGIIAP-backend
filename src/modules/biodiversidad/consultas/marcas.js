export const MAXIMO_CODIGOS = 50;
const PATRON_CODIGO = /^[A-Z][A-Z0-9_]{2,80}$/;

/** Códigos de calidad de GBIF (p. ej. COORDINATE_ROUNDED): solo cadenas con forma de código, sin repetidos. */
export function codigosGbif(valor) {
  if (!Array.isArray(valor)) return [];
  const validos = valor.filter((c) => typeof c === 'string' && PATRON_CODIGO.test(c));
  return [...new Set(validos)].slice(0, MAXIMO_CODIGOS);
}
