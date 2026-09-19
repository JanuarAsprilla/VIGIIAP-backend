import { z } from 'zod';
import * as prefsService from './prefs.service.js';

const updateSchema = z.object({ enPantalla: z.boolean() });

/** GET /api/v1/notificaciones/prefs */
export async function index(req, res, next) {
  try {
    res.json({ data: await prefsService.obtener(req.user.id, req.user.rol) });
  } catch (err) { next(err); }
}

/** PATCH /api/v1/notificaciones/prefs/:clave */
export async function update(req, res, next) {
  try {
    const { enPantalla } = updateSchema.parse(req.body);
    await prefsService.actualizar(req.user.id, req.params.clave, enPantalla);
    res.json({ message: 'Preferencia actualizada' });
  } catch (err) { next(err); }
}
