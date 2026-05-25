import crypto from 'node:crypto';
import multer from 'multer';
import { uploadFile, isPublicUrl } from '../config/r2.js';
import { validateFile, sha256 } from './fileGuard.js';
import { registrarScanArchivo } from '../utils/dataCustody.js';

const storage = multer.memoryStorage();

/**
 * Crea un middleware que parsea multipart, valida cada archivo y lo sube a R2.
 * Las URLs resultantes se inyectan en req.body como `${campo}_url`.
 *
 * @param {Array<{name: string, folder: string, maxSizeMB?: number, category?: 'document'|'image'|'thumbnail'}>} fields
 */
export function uploadFields(fields) {
  const multerFields = fields.map(({ name }) => ({ name, maxCount: 1 }));

  const upload = multer({
    storage,
    limits: { fileSize: Math.max(...fields.map(f => (f.maxSizeMB ?? 20))) * 1024 * 1024 },
  }).fields(multerFields);

  return [
    // 1. Parsear multipart
    (req, res, next) => upload(req, res, (err) => {
      if (err) return next(Object.assign(err, { status: 400 }));
      next();
    }),

    // 2. Validar archivos (magic bytes, MIME, extensión, malware)
    async (req, res, next) => {
      if (!req.files) return next();

      const userId = req.user?.id ?? null;
      const ip     = req.ip ?? null;

      for (const field of fields) {
        const fileArr = req.files[field.name];
        if (!fileArr?.length) continue;

        const file     = fileArr[0];
        const category = field.category ?? 'document';
        const result   = validateFile(file, category);
        const hash     = result.hash ?? sha256(file.buffer);

        if (!result.valid) {
          registrarScanArchivo({
            archivoKey:   `${field.folder}/REJECTED-${Date.now()}`,
            sha256Hash:   hash,
            mimeType:     file.mimetype,
            tamanioBytes: file.size,
            uploadedBy:   userId,
            ipOrigen:     ip,
            resultado:    'rejected',
            detalle:      result.error,
          });
          return res.status(422).json({ error: result.error });
        }

        file._sanitizedExt = result.sanitizedExt;
        file._sha256        = hash;
      }
      next();
    },

    // 3. Subir archivos a R2 y registrar scan clean
    async (req, res, next) => {
      try {
        if (!req.files) return next();

        const userId = req.user?.id ?? null;
        const ip     = req.ip ?? null;

        for (const field of fields) {
          const fileArr = req.files[field.name];
          if (!fileArr?.length) continue;

          const file = fileArr[0];
          const ext  = file._sanitizedExt ?? file.originalname.split('.').pop().toLowerCase();
          const key  = `${field.folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

          // Imágenes y thumbnails van al bucket público; PDFs/documentos al privado
          const isPublic = ['image', 'thumbnail'].includes(field.category ?? 'document');
          const url = await uploadFile(key, file.buffer, file.mimetype, isPublic);
          req.body[`${field.name}_url`]         = url;
          req.body[`${field.name}_tamano_bytes`] = file.size;

          registrarScanArchivo({
            archivoKey:   key,
            sha256Hash:   file._sha256 ?? sha256(file.buffer),
            mimeType:     file.mimetype,
            tamanioBytes: file.size,
            uploadedBy:   userId,
            ipOrigen:     ip,
            resultado:    'clean',
          });
        }
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/** Upload de un único archivo (shorthand). */
export function uploadSingle(name, folder, maxSizeMB = 20, category = 'document') {
  return uploadFields([{ name, folder, maxSizeMB, category }]);
}
