import crypto from 'crypto';
import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { validateFile, sha256 } from '../../middlewares/fileGuard.js';
import { uploadFile, getPresignedUrl, deleteFileByUrl, extractKey } from '../../config/r2.js';
import { registrarScanArchivo } from '../../utils/dataCustody.js';

const ESTADOS = ['pendiente', 'en_revision', 'aprobada', 'rechazada', 'resuelta'];

// Transiciones válidas por estado actual
const TRANSITIONS = {
  pendiente:   ['en_revision', 'aprobada', 'rechazada'],
  en_revision: ['pendiente', 'aprobada', 'rechazada', 'resuelta'],
  aprobada:    ['resuelta', 'en_revision'],
  rechazada:   ['en_revision', 'aprobada'],
  resuelta:    [], // estado final
};

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { estado, tipo } = reqQuery;
  const params = [];
  const conditions = [];

  if (estado && ESTADOS.includes(estado)) {
    params.push(estado);
    conditions.push(`s.estado = $${params.length}`);
  }
  const TIPOS_VALIDOS = ['uso-suelo', 'linderos', 'estudio-ambiental', 'validacion', 'aprovechamiento', 'otro'];
  if (tipo) {
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw Object.assign(new Error(`tipo inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}`), { status: 400 });
    }
    params.push(tipo);
    conditions.push(`s.tipo = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT s.id, s.tipo, s.descripcion, s.estado, s.nota_admin,
              s.creado_en, s.actualizado_en, s.respondida_en,
              u.nombre AS solicitante, u.email,
              r.nombre AS revisado_por_nombre
       FROM solicitudes s
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN usuarios r ON r.id = s.revisado_por
       ${where}
       ORDER BY
         CASE s.estado WHEN 'pendiente' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END,
         s.creado_en ASC`,
      params.slice(0, -2)
    ),
    query(`SELECT COUNT(*) FROM solicitudes s ${where}`, params.slice(0, -2)),
  ]);

  // Añadir días pendiente a cada solicitud
  const enriched = data.rows.map((s) => ({
    ...s,
    dias_pendiente: Math.floor(
      (Date.now() - new Date(s.creado_en).getTime()) / 86_400_000
    ),
  }));

  return { data: enriched, meta: meta(Number(count.rows[0].count)) };
}

export async function getMine(userId, reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rows: data } = await query(
    `SELECT id, tipo, descripcion, estado, nota_admin, respondida_en,
            creado_en, actualizado_en
     FROM solicitudes WHERE usuario_id=$1
     ORDER BY creado_en DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const { rows: c } = await query(
    'SELECT COUNT(*) FROM solicitudes WHERE usuario_id=$1', [userId]
  );
  return { data, meta: meta(Number(c[0].count)) };
}

export async function getById(id, userId, isAdmin) {
  const params = [id];
  const ownerClause = isAdmin ? '' : 'AND s.usuario_id = $2';
  if (!isAdmin) params.push(userId);

  const { rows } = await query(
    `SELECT s.id, s.tipo, s.descripcion, s.estado, s.nota_admin,
            s.creado_en, s.actualizado_en, s.respondida_en,
            u.nombre AS solicitante, u.email,
            r.nombre AS revisado_por_nombre
     FROM solicitudes s
     JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN usuarios r ON r.id = s.revisado_por
     WHERE s.id = $1 ${ownerClause}`,
    params
  );
  if (!rows[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  // Rate limit: máximo 5 solicitudes por usuario en las últimas 24 horas
  const { rows: recent } = await query(
    `SELECT COUNT(*) FROM solicitudes
     WHERE usuario_id = $1 AND creado_en > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  if (Number(recent[0].count) >= 5) {
    throw Object.assign(
      new Error('Límite alcanzado: máximo 5 solicitudes por día. Intenta mañana.'),
      { status: 429 }
    );
  }

  const { rows } = await query(
    `INSERT INTO solicitudes (tipo, descripcion, usuario_id)
     VALUES ($1,$2,$3) RETURNING *`,
    [data.tipo, data.descripcion, userId]
  );
  return rows[0];
}

export async function updateEstado(id, estado, nota, adminId) {
  if (!ESTADOS.includes(estado)) {
    throw Object.assign(new Error('Estado inválido'), { status: 400 });
  }

  // Obtener estado actual para validar la transición
  const { rows: current } = await query(
    'SELECT estado FROM solicitudes WHERE id = $1', [id]
  );
  if (!current[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });

  const estadoActual = current[0].estado;
  const permitidos = TRANSITIONS[estadoActual] ?? [];
  if (!permitidos.includes(estado)) {
    throw Object.assign(
      new Error(
        `Transición inválida: "${estadoActual}" → "${estado}". ` +
        `Transiciones permitidas: ${permitidos.length ? permitidos.join(', ') : 'ninguna (estado final)'}`
      ),
      { status: 422 }
    );
  }

  const { rows } = await query(
    `UPDATE solicitudes SET estado=$1, nota_admin=$2, revisado_por=$3, actualizado_en=NOW()
     WHERE id=$4 RETURNING *`,
    [estado, nota ?? null, adminId, id]
  );
  return rows[0];
}

// ─── Archivos adjuntos ────────────────────────────────────────────────────────

const MAX_ARCHIVOS = 5;

function validateSolicitudFile(file) {
  const docResult = validateFile(file, 'document');
  if (docResult.valid) return docResult;
  const imgResult = validateFile(file, 'image');
  if (imgResult.valid) return imgResult;
  return { valid: false, error: 'Tipo de archivo no permitido. Aceptados: PDF, JPEG, PNG, WebP.' };
}

export async function addArchivo(solicitudId, file, userId, isAdmin, ip) {
  // Verificar acceso: el dueño o el admin pueden adjuntar
  const params = [solicitudId];
  const ownerClause = isAdmin ? '' : 'AND usuario_id = $2';
  if (!isAdmin) params.push(userId);
  const { rows: sol } = await query(
    `SELECT id, estado FROM solicitudes WHERE id = $1 ${ownerClause}`, params
  );
  if (!sol[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  if (sol[0].estado === 'resuelta' && !isAdmin) {
    throw Object.assign(new Error('No se pueden adjuntar archivos a una solicitud ya resuelta'), { status: 422 });
  }

  // Verificar límite de archivos
  const { rows: cnt } = await query(
    'SELECT COUNT(*) FROM solicitud_archivos WHERE solicitud_id = $1', [solicitudId]
  );
  if (Number(cnt[0].count) >= MAX_ARCHIVOS) {
    throw Object.assign(
      new Error(`Límite de ${MAX_ARCHIVOS} archivos por solicitud alcanzado`), { status: 422 }
    );
  }

  // Validar contenido del archivo
  const validation = validateSolicitudFile(file);
  const hash = sha256(file.buffer);

  if (!validation.valid) {
    registrarScanArchivo({
      archivoKey: `solicitudes/${solicitudId}/rejected-${Date.now()}`,
      sha256Hash: hash, mimeType: file.mimetype,
      tamanioBytes: file.buffer.length, uploadedBy: userId, ipOrigen: ip,
      resultado: 'rejected', detalle: validation.error,
    }).catch(() => {});
    throw Object.assign(new Error(validation.error), { status: 422 });
  }

  const MIME_TO_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = MIME_TO_EXT[file.mimetype] ?? 'bin';
  const key = `solicitudes/${solicitudId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const url = await uploadFile(key, file.buffer, file.mimetype, false);

  registrarScanArchivo({
    archivoKey: key, sha256Hash: hash, mimeType: file.mimetype,
    tamanioBytes: file.buffer.length, uploadedBy: userId, ipOrigen: ip,
    resultado: 'clean',
  }).catch(() => {});

  const { rows } = await query(
    `INSERT INTO solicitud_archivos (solicitud_id, nombre, url, mime_type, tamano_bytes, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nombre, mime_type, tamano_bytes, creado_en`,
    [solicitudId, file.originalname, url, file.mimetype, file.buffer.length, userId]
  );
  return rows[0];
}

export async function getArchivos(solicitudId, userId, isAdmin) {
  const params = [solicitudId];
  const ownerCheck = isAdmin ? '' : `
    AND EXISTS (
      SELECT 1 FROM solicitudes WHERE id = $1 AND usuario_id = $2
    )`;
  if (!isAdmin) params.push(userId);

  const { rows: sol } = await query(
    `SELECT id FROM solicitudes WHERE id = $1 ${isAdmin ? '' : 'AND usuario_id = $2'}`, params
  );
  if (!sol[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });

  const { rows } = await query(
    `SELECT sa.id, sa.nombre, sa.mime_type, sa.tamano_bytes, sa.creado_en,
            u.nombre AS subido_por_nombre
     FROM solicitud_archivos sa
     LEFT JOIN usuarios u ON u.id = sa.subido_por
     WHERE sa.solicitud_id = $1
     ORDER BY sa.creado_en ASC`,
    [solicitudId]
  );
  return rows;
}

export async function getArchivoPresignedUrl(solicitudId, archivoId, userId, isAdmin) {
  const params = [solicitudId];
  if (!isAdmin) params.push(userId);

  const { rows: sol } = await query(
    `SELECT id FROM solicitudes WHERE id = $1 ${isAdmin ? '' : 'AND usuario_id = $2'}`, params
  );
  if (!sol[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });

  const { rows } = await query(
    'SELECT url, nombre FROM solicitud_archivos WHERE id = $1 AND solicitud_id = $2',
    [archivoId, solicitudId]
  );
  if (!rows[0]) throw Object.assign(new Error('Archivo no encontrado'), { status: 404 });

  const key = extractKey(rows[0].url);
  if (!key) throw Object.assign(new Error('No se pudo generar el enlace de descarga'), { status: 500 });

  const presignedUrl = await getPresignedUrl(key, 180);
  return { url: presignedUrl, nombre: rows[0].nombre };
}

export async function removeArchivo(solicitudId, archivoId, adminId) {
  const { rows } = await query(
    'SELECT url FROM solicitud_archivos WHERE id = $1 AND solicitud_id = $2',
    [archivoId, solicitudId]
  );
  if (!rows[0]) throw Object.assign(new Error('Archivo no encontrado'), { status: 404 });

  await deleteFileByUrl(rows[0].url);
  await query('DELETE FROM solicitud_archivos WHERE id = $1', [archivoId]);
}

// ─── Responder ────────────────────────────────────────────────────────────────

export async function responder(id, respuesta, adminId) {
  const { rows: current } = await query(
    'SELECT estado FROM solicitudes WHERE id = $1', [id]
  );
  if (!current[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  // Validar transición FSM — responder solo es válido desde estados aprobada o en_revision
  const ESTADOS_PERMITIDOS_RESPONDER = ['aprobada', 'en_revision'];
  if (!ESTADOS_PERMITIDOS_RESPONDER.includes(current[0].estado)) {
    throw Object.assign(
      new Error(`Solo se puede resolver una solicitud aprobada o en revisión. Estado actual: "${current[0].estado}"`),
      { status: 422 }
    );
  }

  const { rows } = await query(
    `UPDATE solicitudes
     SET estado='resuelta', nota_admin=$1, revisado_por=$2,
         respondida_en=NOW(), actualizado_en=NOW()
     WHERE id=$3 RETURNING *`,
    [respuesta, adminId, id]
  );
  return rows[0];
}
