/**
 * fichasMedios.middleware — subida del medio de una ficha (`archivo`, foto o
 * video en el mismo campo, más un `poster` opcional para video).
 *
 * A diferencia de uploadFields() (src/middlewares/upload.js), usa
 * multer.diskStorage(): un video puede pesar hasta 300 MB y NUNCA debe
 * bufferizarse completo en memoria durante la petición (ver el plan "Fichas
 * por punto en geovisores" § Reglas de subida). La validación de magic bytes
 * se hace sobre el archivo ya en disco (fileGuard.js `validateFileHeader`),
 * nunca sobre un buffer completo.
 *
 * Deja `req.medioFicha = { tipo, path, posterPath?, originalname, mime, bytes }`
 * para que el controller/service decida qué hacer -- este middleware no sube
 * nada a R2 ni toca la base de datos, y NO borra los archivos temporales: la
 * imagen se borra apenas se lee (fichas.service.js), el video sobrevive hasta
 * que termina la transcodificación en segundo plano (que ocurre después de
 * responder al cliente).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { validateFileHeader } from '../../middlewares/fileGuard.js';

const MAX_IMAGEN_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
// Margen sobre el máximo de video para el guard de Content-Length (boundary/headers multipart + poster).
const LIMITE_REQUEST_BYTES = Math.round(MAX_VIDEO_BYTES * 1.2);

const TMP_DIR = path.join(os.tmpdir(), 'vigiiap-fichas-medios');
fs.mkdirSync(TMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: TMP_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}-${file.fieldname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_BYTES }, // ceiling común; el límite real por tipo se aplica después de saber cuál es
}).fields([{ name: 'archivo', maxCount: 1 }, { name: 'poster', maxCount: 1 }]);

function borrarSiExiste(rutaArchivo) {
  if (!rutaArchivo) return;
  // Síncrono a propósito: son archivos de rechazo (formato inválido, tamaño excedido),
  // nunca el video completo -- el costo es despreciable y evita dejar temporales huérfanos
  // en el disco si el proceso se reinicia antes de que un rm() asíncrono termine.
  fs.rmSync(rutaArchivo, { force: true });
}

export const uploadMedioFicha = [
  // 0. Guardia de Content-Length -- rechaza antes de escribir un solo byte a disco.
  (req, res, next) => {
    const cl = parseInt(req.headers['content-length'] ?? '0', 10);
    if (cl > LIMITE_REQUEST_BYTES) {
      return res.status(413).json({
        error: `Carga demasiado grande. Máximo por request: ${Math.round(LIMITE_REQUEST_BYTES / 1024 / 1024)} MB`,
      });
    }
    next();
  },

  // 1. Parsear multipart (streaming a disco, nunca a memoria)
  (req, res, next) => upload(req, res, (err) => {
    if (err) return next(Object.assign(err, { status: 400 }));
    next();
  }),

  // 2. Validar el archivo principal (magic bytes) y resolver si es imagen o video
  (req, res, next) => {
    const archivo = req.files?.archivo?.[0];
    const poster = req.files?.poster?.[0];

    if (!archivo) {
      borrarSiExiste(poster?.path);
      return res.status(400).json({ error: 'Falta el archivo del medio (campo "archivo")' });
    }

    const resultado = validateFileHeader(archivo.path, archivo.originalname, archivo.mimetype, 'medioFicha');
    if (!resultado.valid) {
      borrarSiExiste(archivo.path);
      borrarSiExiste(poster?.path);
      return res.status(422).json({ error: resultado.error });
    }

    const tipo = resultado.mime.startsWith('image/') ? 'imagen' : 'video';
    const maxBytes = tipo === 'imagen' ? MAX_IMAGEN_BYTES : MAX_VIDEO_BYTES;
    if (archivo.size > maxBytes) {
      borrarSiExiste(archivo.path);
      borrarSiExiste(poster?.path);
      return res.status(422).json({
        error: `El archivo supera el tamaño máximo de ${Math.round(maxBytes / 1024 / 1024)} MB para ${tipo === 'imagen' ? 'imágenes' : 'videos'}`,
      });
    }

    // El poster solo tiene sentido para video -- si llegó uno para una imagen, se descarta sin error
    // (el cliente no debería mandarlo, pero no es motivo para rechazar la subida completa).
    let posterPath;
    if (tipo === 'video' && poster) {
      const resultadoPoster = validateFileHeader(poster.path, poster.originalname, poster.mimetype, 'thumbnail');
      if (!resultadoPoster.valid) {
        borrarSiExiste(archivo.path);
        borrarSiExiste(poster.path);
        return res.status(422).json({ error: `Poster inválido: ${resultadoPoster.error}` });
      }
      posterPath = poster.path;
    } else {
      borrarSiExiste(poster?.path);
    }

    req.medioFicha = {
      tipo,
      path: archivo.path,
      posterPath,
      originalname: archivo.originalname,
      mime: resultado.mime,
      bytes: archivo.size,
    };
    next();
  },
];
