import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { conBloqueo } from '../../utils/bloqueoTareas.js';
import { sincronizarConexion } from './inventarioGeoserver.service.js';

export const INTERVALO_SINCRONIZACION_POR_DEFECTO_MS = 10 * 60 * 1000;
// Da tiempo a que el servidor termine de arrancar antes del primer ciclo.
export const RETRASO_PRIMER_CICLO_MS = 30_000;

let temporizadorInicial = null;
let intervalo = null;
let cicloEnCurso = false;

const estaApagado = () => process.env.GEOSERVER_SYNC === 'false';

function intervaloConfigurado() {
  const valor = Number(process.env.GEOSERVER_SYNC_INTERVALO_MS);
  return Number.isFinite(valor) && valor > 0 ? valor : INTERVALO_SINCRONIZACION_POR_DEFECTO_MS;
}

async function sincronizarActivas() {
  const { rows } = await query('SELECT id FROM conexiones_geoserver WHERE activo = true ORDER BY nombre', []);
  for (const { id } of rows) {
    try {
      await sincronizarConexion(id, { origen: 'planificador' });
    } catch (err) {
      // Otra instancia o una petición a demanda ya la está sincronizando: se retoma en el siguiente ciclo.
      if (err.code !== 'SINCRONIZACION_EN_CURSO') logger.warn(`[inventario-geoserver] conexión ${id} omitida: ${err.message}`);
    }
  }
}

/** Un ciclo: solo una instancia recorre las conexiones activas; nunca lanza ni se solapa con el ciclo anterior. */
export async function ejecutarCicloSincronizacion() {
  if (cicloEnCurso) return;
  cicloEnCurso = true;
  try {
    await conBloqueo('geoserver_inventario_ciclo', sincronizarActivas);
  } catch (err) {
    logger.warn(`[inventario-geoserver] ciclo de sincronización fallido: ${err.message}`);
  } finally {
    cicloEnCurso = false;
  }
}

/** Primer ciclo poco después de arrancar y luego cada GEOSERVER_SYNC_INTERVALO_MS (10 min). Apagable con GEOSERVER_SYNC=false. */
export function iniciarSincronizacionInventario({ intervaloMs = intervaloConfigurado(), retrasoInicialMs = RETRASO_PRIMER_CICLO_MS } = {}) {
  detenerSincronizacionInventario();
  if (estaApagado()) {
    logger.info('[inventario-geoserver] sincronización periódica apagada (GEOSERVER_SYNC=false)');
    return null;
  }
  temporizadorInicial = setTimeout(ejecutarCicloSincronizacion, retrasoInicialMs);
  temporizadorInicial.unref?.();
  intervalo = setInterval(ejecutarCicloSincronizacion, intervaloMs);
  intervalo.unref?.();
  return intervalo;
}

export function detenerSincronizacionInventario() {
  clearTimeout(temporizadorInicial);
  clearInterval(intervalo);
  temporizadorInicial = null;
  intervalo = null;
}
