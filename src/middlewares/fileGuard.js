/**
 * fileGuard — Validación de archivos subidos al servidor.
 *
 * Protege contra malware disfrazado (magic byte spoofing), doble extensión
 * (shell.pdf.php), manipulación del MIME type, ejecutables ocultos y path
 * traversal en el nombre de archivo. No reemplaza un antivirus, pero filtra
 * la superficie de ataque antes de que el archivo llegue a R2.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

// Bytes de cabecera suficientes para toda firma en MAGIC_SIGNATURES/MALWARE_SIGNATURES
// (la más profunda es WEBP: offset 8 + 4 bytes) -- con margen, para lecturas desde disco.
export const HEADER_BYTES = 32;

// ─── Firmas de bytes mágicos por MIME type ────────────────────────────────────
// Solo se comprueba el inicio del buffer (offset 0 salvo indicación)
const MAGIC_SIGNATURES = {
  'application/pdf': [
    { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
  'image/jpeg': [
    { bytes: [0xFF, 0xD8, 0xFF] },
  ],
  'image/png': [
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // ‰PNG
  ],
  'image/webp': [
    { bytes: [0x52, 0x49, 0x46, 0x46], extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } }, // RIFF....WEBP
  ],
  'image/gif': [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  ],
  // Contenedor ISO-BMFF (mp4/mov de celular): caja "ftyp" en offset 4, casi
  // universal en archivos producidos por cámaras/teléfonos modernos. No es un
  // parseo exhaustivo de ISO-BMFF (un mov muy antiguo sin ftyp no matchea),
  // pero cubre el caso real que van a subir los administradores del IIAP.
  'video/mp4':       [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // ftyp
  'video/quicktime': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // mismo contenedor ISO-BMFF
  'video/webm':      [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }],            // cabecera EBML (WebM/Matroska)
};

// ─── Firmas de ejecutables/malware conocidos (lista negra) ───────────────────
const MALWARE_SIGNATURES = [
  { bytes: [0x4D, 0x5A],                   label: 'Windows PE/EXE' },
  { bytes: [0x7F, 0x45, 0x4C, 0x46],       label: 'ELF (Linux executable)' },
  { bytes: [0xCA, 0xFE, 0xBA, 0xBE],       label: 'Java class file' },
  { bytes: [0x50, 0x4B, 0x03, 0x04],       label: 'ZIP archive (may contain scripts)' },
  { bytes: [0x1F, 0x8B],                    label: 'gzip archive' },
  { bytes: [0x42, 0x5A, 0x68],             label: 'bzip2 archive' },
  { bytes: [0x52, 0x61, 0x72, 0x21],       label: 'RAR archive' },
  { bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], label: '7-Zip archive' },
  { bytes: [0x23, 0x21],                   label: 'Script shebang (#!)' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0],       label: 'Microsoft Office (OLE) legacy — puede contener macros' },
];

// ─── Mapa extensión → MIME esperado ──────────────────────────────────────────
const EXT_TO_MIME = {
  pdf:  'application/pdf',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  gif:  'image/gif',
  mp4:  'video/mp4',
  mov:  'video/quicktime',
  webm: 'video/webm',
};

// ─── Tipos permitidos por categoría de campo ─────────────────────────────────
const ALLOWED_BY_CATEGORY = {
  document:  new Set(['application/pdf']),
  image:     new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  thumbnail: new Set(['image/jpeg', 'image/png', 'image/webp']),
  // Fichas por punto: una foto o un video en el mismo campo de subida -- el
  // tipo real ('imagen'|'video') se resuelve del MIME esperado ya validado
  // aquí, ver fichasMedios.middleware.js.
  medioFicha: new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
};

// ─── Utilidades ──────────────────────────────────────────────────────────────

function matchesSignature(buffer, sig) {
  const offset = sig.offset ?? 0;
  const slice = buffer.slice(offset, offset + sig.bytes.length);
  const match = sig.bytes.every((b, i) => slice[i] === b);
  if (!match) return false;
  if (sig.extra) {
    const extraSlice = buffer.slice(sig.extra.offset, sig.extra.offset + sig.extra.bytes.length);
    return sig.extra.bytes.every((b, i) => extraSlice[i] === b);
  }
  return true;
}

function detectMalware(buffer) {
  for (const sig of MALWARE_SIGNATURES) {
    if (matchesSignature(buffer, sig)) return sig.label;
  }
  return null;
}

function validateMagicBytes(buffer, mimeType) {
  const sigs = MAGIC_SIGNATURES[mimeType];
  if (!sigs) return false;
  return sigs.some((sig) => matchesSignature(buffer, sig));
}

function sanitizeFilename(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '_')
    .slice(0, 200)
    .trim() || 'archivo';
}

function extractSingleExt(filename) {
  // Solo toma la última extensión — previene doble-extensión (shell.php.pdf → 'pdf')
  const parts = sanitizeFilename(filename).split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Calcula SHA-256 del buffer para registro de integridad.
 * @param {Buffer} buffer
 * @returns {string} hex digest
 */
export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validación compartida contra:
 *  1. Lista negra de ejecutables/malware (magic bytes)
 *  2. Whitelist de extensiones permitidas
 *  3. Consistencia extensión ↔ MIME type
 *  4. Magic bytes del tipo declarado
 *
 * Recibe solo la CABECERA del archivo (no necesita el contenido completo --
 * todas las firmas anteriores viven en los primeros bytes) para que también
 * sirva a archivos que se procesan en disco (video, nunca cargado entero en
 * memoria -- ver validateFileHeader).
 */
function validateContenido(headerBuffer, originalname, mimetype, allowedCategory) {
  const allowed = ALLOWED_BY_CATEGORY[allowedCategory];
  if (!allowed) {
    return { valid: false, error: `Categoría de campo desconocida: ${allowedCategory}` };
  }

  if (!headerBuffer?.length) {
    return { valid: false, error: 'El archivo está vacío' };
  }

  // 1. Detección de malware / ejecutables antes de cualquier otra validación
  const malwareLabel = detectMalware(headerBuffer);
  if (malwareLabel) {
    return {
      valid: false,
      error: `Archivo rechazado — firma de archivo potencialmente malicioso detectada (${malwareLabel})`,
    };
  }

  // 2. Extensión única (protege contra doble-extensión)
  const ext = extractSingleExt(originalname ?? '');
  if (!ext) {
    return { valid: false, error: 'El archivo no tiene extensión' };
  }

  const expectedMime = EXT_TO_MIME[ext];
  if (!expectedMime || !allowed.has(expectedMime)) {
    const acceptedExts = Object.entries(EXT_TO_MIME)
      .filter(([, mime]) => allowed.has(mime))
      .map(([e]) => `.${e}`)
      .join(', ');
    return {
      valid: false,
      error: `Extensión .${ext} no permitida. Aceptadas: ${acceptedExts}`,
    };
  }

  // 3. MIME type reportado por el cliente (no confiable, solo referencia)
  const clientMime = (mimetype ?? '').toLowerCase().split(';')[0].trim();
  if (
    clientMime &&
    clientMime !== 'application/octet-stream' &&
    clientMime !== expectedMime
  ) {
    return {
      valid: false,
      error: `MIME inconsistente: la extensión .${ext} requiere ${expectedMime}, el cliente reportó ${clientMime}`,
    };
  }

  // 4. Magic bytes — comprobación del contenido real del archivo
  if (!validateMagicBytes(headerBuffer, expectedMime)) {
    return {
      valid: false,
      error: `El contenido del archivo no corresponde a .${ext} — posible archivo malicioso o corrupto`,
    };
  }

  return { valid: true, sanitizedExt: ext, mime: expectedMime };
}

/**
 * Valida un archivo cargado por completo en memoria (objeto multer con
 * `.buffer`) -- ver validateFileHeader para archivos que viven en disco.
 * @param {object} file            - Objeto multer (buffer, originalname, mimetype, size)
 * @param {string} allowedCategory - 'document' | 'image' | 'thumbnail' | 'medioFicha'
 * @returns {{ valid: boolean, error?: string, hash?: string, sanitizedExt?: string, mime?: string }}
 */
export function validateFile(file, allowedCategory = 'document') {
  const resultado = validateContenido(file?.buffer, file?.originalname, file?.mimetype, allowedCategory);
  if (!resultado.valid) return resultado;
  return { ...resultado, hash: sha256(file.buffer) };
}

/**
 * Misma validación que validateFile, pero para un archivo en disco -- lee
 * solo los primeros HEADER_BYTES (todas las firmas están ahí), nunca el
 * archivo completo. Usado por la subida de medios de fichas (video puede
 * pesar hasta 300 MB, nunca se procesa entero en memoria antes de validarlo).
 * @param {string} filePath
 * @param {string} originalname
 * @param {string} mimetype
 * @param {string} allowedCategory
 * @returns {{ valid: boolean, error?: string, sanitizedExt?: string, mime?: string }}
 */
export function validateFileHeader(filePath, originalname, mimetype, allowedCategory) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const bytesLeidos = fs.readSync(fd, header, 0, HEADER_BYTES, 0);
    return validateContenido(header.subarray(0, bytesLeidos), originalname, mimetype, allowedCategory);
  } finally {
    fs.closeSync(fd);
  }
}

/** SHA-256 de un archivo en disco, por streaming -- nunca carga el archivo completo en memoria. */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
