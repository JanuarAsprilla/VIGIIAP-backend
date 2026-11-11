import * as biodiversidad from '../biodiversidad/biodiversidad.service.js';
import { exportacionRegistrosQuerySchema } from '../biodiversidad/biodiversidad.schema.js';
import { ConsultaInvalida } from '../biodiversidad/biodiversidad.errores.js';
import { herramientaDisponible } from '../herramientas/herramientas.service.js';
import { configuracionPublica, tieneCuenta } from './informes.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const HERRAMIENTA = 'biodiversidad';
/** Formatos que sacan los datos de la plataforma; el PDF es un resumen y no pasa por aquí. */
const FORMATOS_DE_DATOS = ['xlsx', 'csv'];
/** Cada exportación puede tardar segundos y mover decenas de miles de filas: pocas a la vez por instancia. */
export const MAXIMO_SIMULTANEAS = 2;

let enCurso = 0;
/** Solo para las pruebas. */
export const _simultaneas = { actuales: () => enCurso, reiniciar: () => { enCurso = 0; } };

/**
 * ¿Puede esta persona exportar registros? Es la misma regla que ve el botón (configuracionPublica), aplicada aquí en el
 * servidor: lo que el botón oculta, la API lo niega. Devuelve el tope de filas, o el error que corresponde.
 */
export function decidirPermiso(config, user) {
  if (!config?.habilitado) return { status: 404, error: 'Recurso no encontrado' };
  if (!config.puedeDescargar) {
    return tieneCuenta(user)
      ? { status: 403, error: 'No tienes permiso para descargar informes.' }
      : { status: 401, error: 'Inicia sesión para descargar informes.' };
  }
  if (!config.formatos.some((f) => FORMATOS_DE_DATOS.includes(f))) {
    return { status: 403, error: 'Esta herramienta no ofrece la descarga de datos.' };
  }
  return { maxFilas: config.maxFilas };
}

function responderError(err, res, next) {
  if (err instanceof ConsultaInvalida) return res.status(err.status).json({ error: err.message });
  // 57014 = tiempo límite de la consulta; no se expone el detalle de la BD.
  if (err?.code === '57014') return res.status(503).json({ error: 'La descarga tardó demasiado. Acota los filtros e inténtalo de nuevo.' });
  return next(err);
}

/** GET /api/v1/informes/biodiversidad/registros — registros individuales con los filtros del tablero, hasta el tope configurado. */
export async function registrosBiodiversidad(req, res, next) {
  try {
    if (!(await herramientaDisponible(HERRAMIENTA, req.user))) return res.status(404).json({ error: 'Recurso no encontrado' });
    const decision = decidirPermiso(await configuracionPublica(HERRAMIENTA, req.user), req.user);
    if (decision.error) return res.status(decision.status).json({ error: decision.error });

    const filtros = exportacionRegistrosQuerySchema.parse(req.query);
    if (enCurso >= MAXIMO_SIMULTANEAS) {
      res.set('Retry-After', '15');
      return res.status(503).json({ error: 'Hay otras descargas en curso. Inténtalo de nuevo en unos segundos.' });
    }
    enCurso += 1;
    let resultado;
    try {
      resultado = await biodiversidad.registrosParaExportar(filtros, decision.maxFilas);
    } finally {
      enCurso -= 1;
    }
    if (!resultado) return res.status(404).json({ error: 'No hay datos cargados para ese grupo' });

    registrarAuditoria({
      accion: 'informe_registros', modulo: 'informes', entidadId: HERRAMIENTA,
      descripcion: `Descarga de registros de ${resultado.grupo}: ${resultado.registros.length}${resultado.truncado ? ' (recortada al tope)' : ''}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.set('Cache-Control', 'no-store');
    return res.json(resultado);
  } catch (err) { return responderError(err, res, next); }
}
