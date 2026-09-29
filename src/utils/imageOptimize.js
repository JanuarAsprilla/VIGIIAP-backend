/**
 * Redimensiona/comprime imágenes antes de subirlas a R2/MinIO. Sin esto, un
 * archivo subido tal cual (hasta 5-10 MB, ver upload.js) se sirve a tamaño
 * completo en cada tarjeta de cada grilla (mapas, categorías, geovisores) --
 * una página con 15-20 tarjetas puede significar 15-20 descargas de varios
 * MB solo para mostrar una miniatura. No hay ningún procesamiento de imagen
 * en el pipeline actual; este módulo lo agrega en el único punto compartido
 * (uploadFields en upload.js) para que aplique a todos los módulos a la vez.
 */
import sharp from 'sharp';

// thumbnail: tarjetas pequeñas en grillas (mapas, categorías, geovisores).
// image: vistas más grandes (imagen de mapa, avatar de usuario) -- más
// margen para que no se vea pixelada al ampliarse.
const LIMITS = {
  thumbnail:   { maxWidth: 480, quality: 75 },
  image:       { maxWidth: 1600, quality: 82 },
  // Fichas por punto: galería curada, se ve a mayor tamaño que una tarjeta de
  // grilla -- más margen de resolución que 'image' (ver plan "Fichas por
  // punto en geovisores" § Recompresión automática).
  fichaImagen: { maxWidth: 2000, quality: 82 },
};

/**
 * @param {Buffer} buffer     - bytes originales, ya validados por fileGuard.js
 * @param {'thumbnail'|'image'|'fichaImagen'} category
 * @returns {Promise<{ buffer: Buffer, mimetype: string, ext: string }>}
 */
export async function optimizeImage(buffer, category) {
  const { maxWidth, quality } = LIMITS[category] ?? LIMITS.image;
  // resolveWithObject: además de los bytes finales, da el ancho/alto YA redimensionado
  // -- las fichas por punto lo necesitan para dimensionar la galería sin otra pasada.
  const { data, info } = await sharp(buffer)
    // withoutEnlargement -- nunca agranda una imagen ya más chica que el máximo.
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, mimetype: 'image/webp', ext: 'webp', width: info.width, height: info.height };
}
