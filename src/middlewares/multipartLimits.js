const MAX_CAMPOS_TEXTO = 60;
const MAX_BYTES_CAMPO_TEXTO = 128 * 1024;
const MAX_PARES_CABECERA = 100;
// Margen del tope de Content-Length: boundary, cabeceras multipart y campos de texto además del archivo.
const MARGEN_CONTENT_LENGTH = 3;

/**
 * Límites de multer. Sin tope de campos/partes un multipart con miles de campos de texto se acumula en memoria y
 * tumba el proceso (el límite de Content-Length no cubre Transfer-Encoding: chunked).
 */
export function limitesMultipart({ fileSize, files }) {
  return {
    fileSize,
    files,
    fields: MAX_CAMPOS_TEXTO,
    fieldSize: MAX_BYTES_CAMPO_TEXTO,
    parts: files + MAX_CAMPOS_TEXTO,
    headerPairs: MAX_PARES_CABECERA,
  };
}

/** Tope de Content-Length de una petición multipart con `files` archivos de `fileSize` bytes como máximo. */
export function topeContentLength({ fileSize, files }) {
  return fileSize * files * MARGEN_CONTENT_LENGTH;
}

/** Envuelve un middleware de multer para que sus fallos (demasiados campos, partes, etc.) sean 400 y no 500. */
export function multipartComoCliente(middlewareMulter) {
  return (req, res, next) => middlewareMulter(req, res, (err) => {
    if (err) return next(Object.assign(err, { status: 400 }));
    next();
  });
}

/** Descarta peticiones sobredimensionadas antes de leer un solo byte del cuerpo. */
export function guardaContentLength(tope) {
  return (req, res, next) => {
    const cl = parseInt(req.headers['content-length'] ?? '0', 10);
    if (cl > tope) {
      return res.status(413).json({
        error: `Carga demasiado grande. Máximo por request: ${Math.round(tope / 1024 / 1024)} MB`,
      });
    }
    next();
  };
}
