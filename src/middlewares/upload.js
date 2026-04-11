import multer from 'multer';
import { uploadFile } from '../config/r2.js';

const storage = multer.memoryStorage();

/**
 * Crea un middleware que parsea multipart y sube cada campo de archivo a R2.
 * Las URLs resultantes se inyectan en req.body como `${campo}_url`.
 *
 * @param {Array<{name: string, folder: string, maxSizeMB?: number}>} fields
 */
export function uploadFields(fields) {
  const multerFields = fields.map(({ name, maxSizeMB = 20 }) => ({
    name,
    maxCount: 1,
  }));

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

    // 2. Subir archivos a R2
    async (req, res, next) => {
      try {
        if (!req.files) return next();

        for (const field of fields) {
          const fileArr = req.files[field.name];
          if (!fileArr?.length) continue;

          const file = fileArr[0];
          const ext = file.originalname.split('.').pop().toLowerCase();
          const key = `${field.folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

          const url = await uploadFile(key, file.buffer, file.mimetype);
          req.body[`${field.name}_url`] = url;
        }
        next();
      } catch (err) {
        next(err);
      }
    },
  ];
}

/** Upload de un único archivo (shorthand). */
export function uploadSingle(name, folder, maxSizeMB = 20) {
  return uploadFields([{ name, folder, maxSizeMB }]);
}
