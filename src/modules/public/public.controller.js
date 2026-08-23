import * as publicService from './public.service.js';

/** GET /api/v1/public/configuracion — sin autenticación */
export async function getConfiguracionPublica(req, res, next) {
  try {
    res.json(await publicService.getConfiguracionPublica());
  } catch (err) { next(err); }
}
