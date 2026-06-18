import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const TABLAS = {
  mapa:      'mapas',
  documento: 'documentos',
  noticia:   'noticias',
  categoria: 'categorias',
};

/** GET /api/admin/papelera?tipo=mapa|documento|noticia|categoria */
export async function getPapelera(req, res, next) {
  try {
    const { tipo, ...rest } = req.query;
    if (!tipo || !TABLAS[tipo]) {
      return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(TABLAS).join(', ')}` });
    }
    const tabla = TABLAS[tipo];
    const { limit, offset, meta } = paginate(rest);

    const [data, count] = await Promise.all([
      query(
        `SELECT * FROM ${tabla} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      query(`SELECT COUNT(*) FROM ${tabla} WHERE deleted_at IS NOT NULL`),
    ]);

    res.json({ data: data.rows, meta: meta(Number(count.rows[0].count)) });
  } catch (err) { next(err); }
}

/** PATCH /api/admin/papelera/:tipo/:id/restaurar */
export async function restaurar(req, res, next) {
  try {
    const { tipo, id } = req.params;
    if (!TABLAS[tipo]) {
      return res.status(400).json({ error: `tipo debe ser uno de: ${Object.keys(TABLAS).join(', ')}` });
    }
    const tabla = TABLAS[tipo];
    const idCol = tipo === 'categoria' ? 'nombre' : 'id';

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
