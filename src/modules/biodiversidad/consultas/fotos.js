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

/** Condición SQL: el registro tiene al menos una foto válida. Recibe los marcadores de los patrones. */
export function sqlTieneFoto(columna, marcadorImagen, marcadorReferencia) {
  return `(${columna} <> '[]'::jsonb AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(${columna}) f
     WHERE f->>'imagen' ~ ${marcadorImagen} AND f->>'referencia' ~ ${marcadorReferencia}))`;
}
