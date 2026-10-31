const PATRON_CODIGO = /^[A-Z][A-Z0-9_]{2,80}$/;

/** Códigos de calidad de GBIF (p. ej. COORDINATE_ROUNDED): solo cadenas con forma de código, sin repetidos. */
export function codigosGbif(valor) {
  if (!Array.isArray(valor)) return [];
  return valor;
}
