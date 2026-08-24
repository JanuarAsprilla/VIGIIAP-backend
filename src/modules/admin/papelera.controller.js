import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

// 'noticia' eliminado — el módulo de noticias fue removido del proyecto.
// Si la tabla aún existe en BD, se puede restaurar aquí, pero el endpoint se mantiene cerrado.
const TABLAS = {
  mapa:      'mapas',
  documento: 'documentos',
  categoria: 'categorias',
};
// Columnas explícitas por tipo — evita exposición de campos futuros con SELECT *
const COLS = {
  mapa:      'm.id, m.titulo, m.slug, m.categoria, m.activo, m.deleted_at',
  documento: 'd.id, d.titulo, d.slug, d.tipo, d.activo, d.deleted_at',
  categoria: 'c.nombre, c.thumbnail_url, c.deleted_at',
};
// Alias de tabla para queries
const ALIAS = { mapa: 'm', documento: 'd', categoria: 'c' };



/** GET /api/admin/papelera?tipo=mapa|documento|noticia|categoria */
export async function getPapelera(req, res, next) {
  try {
    const { tipo, ...rest } = req.query;
    if (!tipo || !TABLAS[tipo]) {
      return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(TABLAS).join(', ')}` });
    }
    const tabla = TABLAS[tipo];
    const { limit, offset, meta } = paginate(rest);

    const alias = ALIAS[tipo];
    const [data, count] = await Promise.all([
      query(
        `SELECT ${COLS[tipo]} FROM ${tabla} ${alias} WHERE ${alias}.deleted_at IS NOT NULL ORDER BY ${alias}.deleted_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query(`SELECT COUNT(*) FROM ${tabla} WHERE deleted_at IS NOT NULL`),
    ]);

    res.json({ data: data.rows, meta: meta(Number(count.rows[0].count)) });
  } catch (err) { next(err); }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/admin/papelera/:tipo/:id/restaurar */
export async function restaurar(req, res, next) {
  try {
    const { tipo, id } = req.params;
    if (!TABLAS[tipo]) {
      return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(TABLAS).join(', ')}` });
    }
    const tabla = TABLAS[tipo];
    const idCol = tipo === 'categoria' ? 'nombre' : 'id';
    // Validar formato: UUID para recursos, texto corto para categorías
    if (idCol === 'id' && !UUID_RE.test(id)) {
      return res.status(400).json({ error: 'id debe ser un UUID válido' });
    }
    if (idCol === 'nombre' && (id.length < 2 || id.length > 100)) {
      return res.status(400).json({ error: 'nombre inválido' });
    }

    const { rows } = await query(
      `UPDATE ${tabla} SET deleted_at = NULL, actualizado_en = NOW()
       WHERE ${idCol} = $1 AND deleted_at IS NOT NULL RETURNING ${idCol}`,
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: `${tipo} no encontrado en papelera` });
    }

    registrarAuditoria({
      accion:       `restaurar_${tipo}`,
      modulo:       'admin',
      entidadId:    id,
      descripcion:  `${tipo} restaurado desde papelera`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });

    res.json({ message: `${tipo} restaurado correctamente` });
  } catch (err) { next(err); }
}
