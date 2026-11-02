/**
 * Las fotos solo se entregan si apuntan a la caché de imágenes de GBIF y citan su fuente por https:
 * nunca la URL original del autor (S3 de terceros). Los patrones se pasan también a SQL como
 * parámetros para que el filtro `con_foto` use exactamente el mismo criterio.
 */
export const PATRON_IMAGEN = '^https://api\\.gbif\\.org/v1/image/cache/[0-9]+x/occurrence/[0-9]+/media/[a-f0-9]{32}$';
export const PATRON_REFERENCIA = '^https://';

const RE_IMAGEN = new RegExp(PATRON_IMAGEN);
const RE_REFERENCIA = new RegExp(PATRON_REFERENCIA);
const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const coincide = (re, texto) => typeof texto === 'string' && re.test(texto);
const texto = (valor) => (typeof valor === 'string' && valor !== '' ? valor : null);

export function fotoValida(foto) {
  return esObjeto(foto) && coincide(RE_IMAGEN, foto.imagen) && coincide(RE_REFERENCIA, foto.referencia);
}

/** Solo los cinco campos públicos de las fotos válidas, en su orden original. */
export function fotosPublicas(fotos) {
  if (!Array.isArray(fotos)) return [];
  return fotos.filter(fotoValida).map((f) => ({
    imagen: f.imagen,
    autor: texto(f.autor),
    editor: texto(f.editor),
    licencia: texto(f.licencia),
    referencia: f.referencia,
  }));
}

const RE_CLAVE_ESPECIE = /^[A-Za-z0-9]{1,20}$/;
const MAX_TEXTO = 300;
const MAX_REFERENCIA = 500;
const recortar = (valor) => (typeof valor === 'string' && valor.trim() !== '' ? valor.trim().slice(0, MAX_TEXTO) : null);

/**
 * Fila de `especie_foto` a partir de una línea del archivo del cargador, o null si no es válida. Lo único que
 * entra a la tabla: seis campos, la imagen solo de la caché de GBIF y la referencia solo por https (el archivo
 * no decide nada más, y la tabla repite estas reglas con CHECK).
 */
export function filaFotoEspecie(entrada) {
  if (!esObjeto(entrada)) return null;
  const { especie_clave: clave, imagen, referencia } = entrada;
  if (typeof clave !== 'string' || !RE_CLAVE_ESPECIE.test(clave)) return null;
  if (!coincide(RE_IMAGEN, imagen)) return null;
  if (!coincide(RE_REFERENCIA, referencia) || referencia.length > MAX_REFERENCIA) return null;
  return {
    especie_clave: clave, imagen, autor: recortar(entrada.autor), editor: recortar(entrada.editor),
    licencia: recortar(entrada.licencia), referencia,
  };
}

/** Condición SQL: el registro tiene al menos una foto válida. Recibe los marcadores de los patrones. */
export function sqlTieneFoto(columna, marcadorImagen, marcadorReferencia) {
  return `(${columna} <> '[]'::jsonb AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(${columna}) f
     WHERE f->>'imagen' ~ ${marcadorImagen} AND f->>'referencia' ~ ${marcadorReferencia}))`;
}
