import * as notificacionesService from './notificaciones.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/v1/notificaciones */
export async function index(req, res, next) {
  try {
    res.json({ data: await notificacionesService.listar(req.user.id) });
  } catch (err) { next(err); }
}

/** PATCH /api/v1/notificaciones/:id/leida */
export async function marcarLeida(req, res, next) {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: 'id debe ser un UUID válido' });
    }
    const marcada = await notificacionesService.marcarLeida(id, req.user.id);
    if (!marcada) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }
    res.json({ message: 'Notificación marcada como leída' });
  } catch (err) { next(err); }
}

/** PATCH /api/v1/notificaciones/leer-todas */
export async function marcarTodasLeidas(req, res, next) {
  try {
    const total = await notificacionesService.marcarTodasLeidas(req.user.id);
    res.json({ message: `${total} notificación(es) marcada(s) como leída(s)` });
  } catch (err) { next(err); }
}
