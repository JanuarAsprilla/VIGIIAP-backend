import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { conBloqueo } from '../../utils/bloqueoTareas.js';
import { obtenerConexionParaConector } from './conexionesGeoserver.service.js';
import * as geoserver from './geoserver.connector.js';
import { TIPOS_INVENTARIO, calcularDiferencias, resumirDiferencias } from './inventarioDiferencias.js';
import { construirInventario } from './inventarioSnapshot.js';
import {
  enTransaccion, leerFilas, aplicarDiferencias, registrarSincronizacion, ultimaSincronizacion, leerInventario,
} from './inventarioGeoserver.store.js';
import { invalidarInventarioCatalogo } from './inventarioCatalogo.js';

// Tope de una sincronización completa: pasado este tiempo se corta y se registra como error, sin tumbar nada.
export const TOPE_SINCRONIZACION_MS = Number(process.env.GEOSERVER_SYNC_TOPE_MS) || 120_000;
const ORDEN_TIPOS = ['espacios', 'capas', 'grupos', 'estilos'];
const CODIGOS_MENSAJE_SEGURO = /^(GEOSERVER_|INVENTARIO_|XML_|RESPUESTA_)/;

const nombreDelBloqueo = (conexionId) => `geoserver_inventario:${conexionId}`;
const ejecutorPool = { query };

/** Mensaje apto para guardar y mostrar: los errores internos (SQL, etc.) nunca se exponen. */
function mensajeSeguro(err) {
  return CODIGOS_MENSAJE_SEGURO.test(err.code ?? '') ? err.message : 'Error interno al guardar el inventario';
}

function motivoRestNoDisponible(err) {
  return err.code === 'GEOSERVER_REST_NO_DISPONIBLE'
    ? `La API REST respondió ${err.status}: se sincronizó solo con los servicios OGC`
    : `La API REST falló (${mensajeSeguro(err)}): se sincronizó solo con los servicios OGC`;
}

/** REST es opcional: cualquier fallo degrada a OGC en vez de abortar. */
async function intentarRest(conexion, venceEn) {
  try {
    const espacios = await geoserver.listarEspaciosRest(conexion, { venceEn });
    const nombres = espacios.map((e) => e.nombre);
    const grupos = await geoserver.listarGruposRest(conexion, { espacios: nombres, venceEn });
    const estilos = await geoserver.listarEstilosRest(conexion, { espacios: nombres, venceEn });
    return { datos: { espacios, grupos, estilos }, motivo: null };
  } catch (err) {
    logger.warn(`[inventario-geoserver] REST no disponible en la conexión ${conexion.id}: ${err.message}`);
    return { datos: null, motivo: motivoRestNoDisponible(err) };
  }
}

async function recolectar(conexion, venceEn) {
  const [wms, wfs, wcs] = await Promise.allSettled([
    geoserver.obtenerCapacidadesWms(conexion, { venceEn }),
    geoserver.obtenerCapacidadesWfs(conexion),
    geoserver.obtenerCapacidadesWcs(conexion),
  ]);
  if (wms.status === 'rejected') throw wms.reason;

  const notas = [];
  if (wfs.status === 'rejected' || wcs.status === 'rejected') notas.push('WFS/WCS no respondieron: se conservó el tipo de capa anterior');

  // Un servidor externo (WMS/WFS de terceros) no tiene API REST que esperar.
  const rest = conexion.tipo === 'externo' ? { datos: null, motivo: null } : await intentarRest(conexion, venceEn);
  if (rest.motivo) notas.push(rest.motivo);

  return {
    wms: wms.value,
    wfs: wfs.status === 'fulfilled' ? wfs.value : null,
    wcs: wcs.status === 'fulfilled' ? wcs.value : null,
    rest: rest.datos,
    notas,
  };
}

async function aplicarInventario(conexionId, inventario, instante, hayRest) {
  // Sin REST no se sabe qué espacios o estilos dejaron de existir: solo capas y grupos (que vienen del WMS) se dan de baja.
  const puedeEliminar = { espacios: hayRest, capas: true, grupos: true, estilos: hayRest };
  const resumen = {};
  for (const tipo of ORDEN_TIPOS) {
    resumen[tipo] = await enTransaccion(async (cliente) => {
      const guardadas = await leerFilas(cliente, tipo, conexionId);
      const diferencias = calcularDiferencias(TIPOS_INVENTARIO[tipo], guardadas, inventario[tipo], puedeEliminar[tipo]);
      await aplicarDiferencias(cliente, tipo, conexionId, diferencias, instante);
      return resumirDiferencias(diferencias);
    });
  }
  return resumen;
}

async function guardarResultado(datos) {
  try {
    await registrarSincronizacion(datos);
  } catch (err) {
    logger.error(`[inventario-geoserver] no se pudo registrar la sincronización: ${err.message}`);
  }
}

async function ejecutar(conexionId, origen) {
  const conexion = await obtenerConexionParaConector(conexionId);
  const inicio = new Date();
  const venceEn = inicio.getTime() + TOPE_SINCRONIZACION_MS;
  const terminar = (resultado) => ({ ...resultado, duracion_ms: Date.now() - inicio.getTime() });

  try {
    const fuentes = await recolectar(conexion, venceEn);
    const [previosEspacios, previasCapas] = await Promise.all([
      leerFilas(ejecutorPool, 'espacios', conexionId),
      leerFilas(ejecutorPool, 'capas', conexionId),
    ]);
    const inventario = construirInventario({ ...fuentes, previos: { espacios: previosEspacios, capas: previasCapas } });
    const resumen = await aplicarInventario(conexionId, inventario, inicio, fuentes.rest !== null);
    invalidarInventarioCatalogo(conexionId);

    const fuente = fuentes.rest ? 'rest+ogc' : 'ogc';
    const estado = fuentes.notas.length > 0 ? 'parcial' : 'ok';
    const error = fuentes.notas.join('; ') || null;
    await guardarResultado({ conexionId, iniciadaEn: inicio, estado, fuente, origen, resumen, error });
    return terminar({ estado, fuente, resumen, error });
  } catch (err) {
    logger.error(`[inventario-geoserver] sincronización fallida en la conexión ${conexionId}: ${err.message}`);
    const error = mensajeSeguro(err);
    await guardarResultado({ conexionId, iniciadaEn: inicio, estado: 'error', fuente: 'ogc', origen, resumen: {}, error });
    return terminar({ estado: 'error', fuente: 'ogc', resumen: {}, error });
  }
}

/**
 * Sincroniza el inventario de una conexión. Con un candado por conexión, el planificador y una petición a demanda
 * (o dos instancias) nunca la sincronizan a la vez; si ya hay una en marcha lanza 409 SINCRONIZACION_EN_CURSO.
 * Una falla de GeoServer no lanza: queda registrada como estado 'error' y el inventario previo se conserva.
 */
export async function sincronizarConexion(conexionId, { origen = 'manual' } = {}) {
  const { ejecutada, resultado } = await conBloqueo(nombreDelBloqueo(conexionId), () => ejecutar(conexionId, origen));
  if (!ejecutada) {
    throw Object.assign(new Error('Ya hay una sincronización en curso para esta conexión'), { status: 409, code: 'SINCRONIZACION_EN_CURSO' });
  }
  return resultado;
}

const sinConexion = ({ conexion_id: _omitida, ...resto }) => resto;
const contarPor = (filas) => filas.reduce((cuenta, f) => cuenta.set(f.espacio, (cuenta.get(f.espacio) ?? 0) + 1), new Map());

/** Vista de administración del inventario guardado: sin credenciales ni URLs internas (nunca se guardan). */
export async function obtenerInventarioAdmin(conexionId, { incluirEliminados = false } = {}) {
  const [sincronizacion, filas] = await Promise.all([
    ultimaSincronizacion(conexionId),
    leerInventario(conexionId, { incluirEliminados }),
  ]);
  const capasPorEspacio = contarPor(filas.capas);
  const gruposPorEspacio = contarPor(filas.grupos);
  return {
    sincronizacion: sincronizacion
      ? {
        iniciada_en: sincronizacion.iniciada_en,
        terminada_en: sincronizacion.terminada_en,
        estado: sincronizacion.estado,
        fuente: sincronizacion.fuente,
        resumen: sincronizacion.resumen,
        error: sincronizacion.error,
      }
      : null,
    espacios: filas.espacios.map((e) => ({
      nombre: e.nombre,
      namespace_uri: e.namespace_uri,
      titulo: e.titulo_servicio,
      resumen: e.resumen_servicio,
      aislado: e.aislado,
      capas: capasPorEspacio.get(e.nombre) ?? 0,
      grupos: gruposPorEspacio.get(e.nombre) ?? 0,
      primera_vez_visto: e.primera_vez_visto,
      ultima_vez_visto: e.ultima_vez_visto,
      eliminado_en: e.eliminado_en,
    })),
    capas: filas.capas.map(sinConexion),
    grupos: filas.grupos.map(sinConexion),
    estilos: filas.estilos.map(sinConexion),
  };
}
