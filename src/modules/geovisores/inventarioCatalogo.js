import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { ultimaSincronizacionUtil } from './inventarioGeoserver.store.js';

// El catálogo público se pide mucho: el inventario cambia cada varios minutos, así que se lee de memoria 30 s.
export const TTL_INVENTARIO_MS = 30_000;
// Un grupo puede contener otros grupos; más allá de esta profundidad se considera mal formado y no se ofrece.
export const MAX_PROFUNDIDAD_GRUPOS = 5;
// El inventario guardado solo sustituye al catálogo en vivo si es de las últimas 24 h.
export const EDAD_MAXIMA_INVENTARIO_MS = Number(process.env.GEOSERVER_INVENTARIO_MAX_EDAD_MS) || 24 * 60 * 60 * 1000;

const cache = new Map();

export function invalidarInventarioCatalogo(conexionId) {
  cache.delete(conexionId);
}

async function leerInventario(conexionId) {
  const sincronizacion = await ultimaSincronizacionUtil(conexionId);
  if (!sincronizacion) return null;
  const [capas, grupos, espacios] = await Promise.all([
    query('SELECT capa_id, espacio, nombre, titulo, resumen, palabras_clave, tipo, estilo_defecto, bbox FROM geoserver_inventario_capas WHERE conexion_id = $1 AND eliminado_en IS NULL', [conexionId]),
    query('SELECT grupo_id, espacio, nombre, titulo, resumen, miembros, bbox FROM geoserver_inventario_grupos WHERE conexion_id = $1 AND eliminado_en IS NULL', [conexionId]),
    query('SELECT nombre, titulo_servicio FROM geoserver_inventario_espacios WHERE conexion_id = $1 AND eliminado_en IS NULL AND titulo_servicio IS NOT NULL', [conexionId]),
  ]);
  return {
    terminadaEn: new Date(sincronizacion.terminada_en).getTime(),
    capas: new Map(capas.rows.map((c) => [c.capa_id, c])),
    grupos: grupos.rows,
    titulosEspacio: new Map(espacios.rows.map((e) => [e.nombre, e.titulo_servicio])),
  };
}

/**
 * Inventario guardado de una conexión para enriquecer el catálogo público, o null si todavía no hay (primera vez) o no
 * se pudo leer: el catálogo en vivo nunca depende de esto.
 */
export async function obtenerInventarioParaCatalogo(conexionId) {
  const guardado = cache.get(conexionId);
  if (guardado && guardado.expira > Date.now()) return guardado.valor;
  try {
    const valor = await leerInventario(conexionId);
    cache.set(conexionId, { valor, expira: Date.now() + TTL_INVENTARIO_MS });
    return valor;
  } catch (err) {
    logger.warn(`[inventario-geoserver] no se pudo leer el inventario para el catálogo: ${err.message}`);
    return null;
  }
}

/** Añade, solo si existen, los datos reales de GeoServer a una capa del catálogo; la forma original no cambia. */
export function enriquecerCapa(capa, inventario) {
  const guardada = inventario?.capas.get(capa.id);
  if (!guardada) return capa;
  return {
    ...capa,
    ...(guardada.titulo ? { titulo: guardada.titulo } : {}),
    ...(guardada.resumen ? { resumen: guardada.resumen } : {}),
    ...(guardada.palabras_clave?.length ? { palabrasClave: guardada.palabras_clave } : {}),
    ...(guardada.estilo_defecto ? { estiloDefecto: guardada.estilo_defecto } : {}),
  };
}

/** Capas del catálogo reconstruidas desde el inventario, para cuando GeoServer no responde. */
export function capasDesdeInventario(inventario) {
  return [...inventario.capas.values()].map((c) => ({
    id: c.capa_id,
    nombre: c.titulo ?? c.capa_id,
    tipo: c.tipo,
    bbox: c.bbox ?? undefined,
  }));
}

function unirBbox(cajas) {
  const validas = cajas.filter(Boolean);
  if (validas.length === 0) return null;
  return {
    oeste: Math.min(...validas.map((c) => c.oeste)),
    sur: Math.min(...validas.map((c) => c.sur)),
    este: Math.max(...validas.map((c) => c.este)),
    norte: Math.max(...validas.map((c) => c.norte)),
  };
}

/** Capas hoja de un grupo, en orden; null si algún miembro no está permitido, falta, o hay ciclo o demasiada profundidad. */
function expandirGrupo(id, grupos, permitidas, profundidad, ruta) {
  const grupo = grupos.get(id);
  if (!grupo || profundidad > MAX_PROFUNDIDAD_GRUPOS || ruta.has(id)) return null;
  const siguienteRuta = new Set(ruta).add(id);
  const hojas = [];
  for (const miembro of grupo.miembros ?? []) {
    if (miembro.tipo === 'grupo') {
      const internas = expandirGrupo(miembro.id, grupos, permitidas, profundidad + 1, siguienteRuta);
      if (!internas) return null;
      hojas.push(...internas);
    } else {
      if (!permitidas.has(miembro.id)) return null;
      hojas.push(miembro.id);
    }
  }
  return hojas;
}

/**
 * Grupos que un geovisor puede ofrecer: SOLO los que tienen todas sus capas entre las ya permitidas para ese geovisor
 * (la lista final del catálogo, que ya aplicó la exclusión de seguridad, las restricciones de hermanos y las capas
 * nuevas). Un solo miembro no permitido, desconocido o un ciclo ocultan el grupo entero; los grupos vacíos no se ofrecen.
 * @param grupos             filas guardadas { grupo_id, espacio, nombre, titulo, resumen, miembros, bbox }
 * @param capasPermitidas    capas del catálogo ya filtradas ({ id, tema, bbox })
 * @param espaciosExcluidos  workspaces que nunca se muestran (defensa en profundidad sobre el espacio del propio grupo)
 * @param temaDeEspacio      espacio → id de tema
 */
export function resolverGruposVisibles({ grupos, capasPermitidas, espaciosExcluidos, temaDeEspacio }) {
  const porId = new Map(grupos.map((g) => [g.grupo_id, g]));
  const permitidas = new Map(capasPermitidas.map((c) => [c.id, c]));
  const excluidos = new Set(espaciosExcluidos);

  return grupos.flatMap((grupo) => {
    const espacio = grupo.espacio ?? (grupo.grupo_id.includes(':') ? grupo.grupo_id.split(':')[0] : null);
    if (espacio && excluidos.has(espacio)) return [];
    const ids = [...new Set(expandirGrupo(grupo.grupo_id, porId, permitidas, 0, new Set()) ?? [])];
    if (ids.length === 0) return [];
    return [{
      id: grupo.grupo_id,
      nombre: grupo.nombre,
      titulo: grupo.titulo ?? grupo.nombre,
      resumen: grupo.resumen ?? null,
      tema: espacio ? temaDeEspacio(espacio) : permitidas.get(ids[0]).tema,
      capas: ids,
      bbox: grupo.bbox ?? unirBbox(ids.map((id) => permitidas.get(id).bbox)),
    }];
  }).sort((a, b) => a.titulo.localeCompare(b.titulo));
}
