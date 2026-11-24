import { z } from 'zod';
import * as conexionService from './conexionesGeoserver.service.js';
import { sincronizarConexion, obtenerInventarioAdmin } from './inventarioGeoserver.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const consultaInventarioSchema = z.object({
  incluirEliminados: z.enum(['true', 'false']).default('false').transform((valor) => valor === 'true'),
});

/** POST /admin/conexiones-geoserver/:id/sincronizar — sincroniza ahora el inventario de la conexión. */
export async function sincronizar(req, res, next) {
  try {
    const { id } = paramsSchema.parse(req.params);
    const conexion = await conexionService.getById(id);
    const resultado = await sincronizarConexion(id, { origen: 'manual' });
    registrarAuditoria({
      accion: 'sincronizar_inventario_geoserver',
      modulo: 'geovisores',
      entidadId: id,
      descripcion: `Inventario de la conexión GeoServer ${conexion.nombre} sincronizado: ${resultado.estado} (${resultado.fuente})`,
      resultado: resultado.estado === 'error' ? 'fallo' : 'exito',
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.json(resultado);
  } catch (err) { next(err); }
}

/** GET /admin/conexiones-geoserver/:id/inventario — inventario guardado, sin credenciales ni URLs internas. */
export async function inventario(req, res, next) {
  try {
    const { id } = paramsSchema.parse(req.params);
    const { incluirEliminados } = consultaInventarioSchema.parse(req.query);
    await conexionService.getById(id);
    res.json(await obtenerInventarioAdmin(id, { incluirEliminados }));
  } catch (err) { next(err); }
}
