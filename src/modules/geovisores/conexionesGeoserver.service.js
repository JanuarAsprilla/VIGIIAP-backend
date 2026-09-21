import { query } from '../../config/database.js';
import { encryptGeoserverPassword, decryptGeoserverPassword } from '../../utils/geoserverEncryption.js';
import { urlApuntaARedPrivada } from '../../utils/ssrfGuard.js';
import * as geoserver from './geoserver.connector.js';

// Nunca se selecciona password_cifrado en las lecturas de listado/detalle expuestas por la API —
// solo internamente (obtenerConexionParaConector) para armar la conexión real hacia GeoServer.
const COLUMNAS_PUBLICAS = 'id, nombre, url, tipo, usuario_lectura, timeout_ms, activo, creado_en, actualizado_en';

export async function getAll() {
  const { rows } = await query(`SELECT ${COLUMNAS_PUBLICAS} FROM conexiones_geoserver ORDER BY nombre`, []);
  return rows;
}

export async function getById(id) {
  const { rows } = await query(`SELECT ${COLUMNAS_PUBLICAS} FROM conexiones_geoserver WHERE id = $1`, [id]);
  if (!rows[0]) throw Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 });
  return rows[0];
}

export async function create(data) {
  const { rows } = await query(
    `INSERT INTO conexiones_geoserver (nombre, url, tipo, usuario_lectura, password_cifrado, timeout_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNAS_PUBLICAS}`,
    [
      data.nombre, data.url, data.tipo ?? 'propio',
      data.usuarioLectura ?? null,
      data.password ? encryptGeoserverPassword(data.password) : null,
      data.timeoutMs,
    ],
  );
  return rows[0];
}

export async function update(id, data) {
  const campos = [];
  const valores = [];
  let indice = 1;

  const asignar = (columna, valor) => {
    campos.push(`${columna} = $${indice}`);
    valores.push(valor);
    indice += 1;
  };

  if (data.nombre !== undefined) asignar('nombre', data.nombre);
  if (data.url !== undefined) asignar('url', data.url);
  if (data.tipo !== undefined) asignar('tipo', data.tipo);
  if (data.usuarioLectura !== undefined) asignar('usuario_lectura', data.usuarioLectura);
  if (data.password !== undefined) asignar('password_cifrado', encryptGeoserverPassword(data.password));
  if (data.timeoutMs !== undefined) asignar('timeout_ms', data.timeoutMs);
  if (data.activo !== undefined) asignar('activo', data.activo);
  campos.push('actualizado_en = NOW()');

  valores.push(id);
  const { rows } = await query(
    `UPDATE conexiones_geoserver SET ${campos.join(', ')} WHERE id = $${indice} RETURNING ${COLUMNAS_PUBLICAS}`,
    valores,
  );
  if (!rows[0]) throw Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 });
  return rows[0];
}

export async function remove(id) {
  const enUso = await query('SELECT id FROM geovisores WHERE conexion_geoserver_id = $1 LIMIT 1', [id]);
  if (enUso.rows[0]) {
    throw Object.assign(
      new Error('No se puede eliminar: hay geovisores publicados usando esta conexión'),
      { status: 409 },
    );
  }
  const { rowCount } = await query('DELETE FROM conexiones_geoserver WHERE id = $1', [id]);
  if (!rowCount) throw Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 });
}

/**
 * Única función que descifra la contraseña -- de uso interno del módulo (geoserver.connector),
 * nunca expuesta directamente por un endpoint. `timeoutMs` se mapea a camelCase aquí porque el
 * conector espera ese shape (ver geoserver.connector.js).
 */
export async function obtenerConexionParaConector(id) {
  const { rows } = await query(
    'SELECT id, url, tipo, usuario_lectura, password_cifrado, timeout_ms, activo FROM conexiones_geoserver WHERE id = $1',
    [id],
  );
  const fila = rows[0];
  if (!fila) throw Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 });
  if (!fila.activo) {
    throw Object.assign(new Error('La conexión GeoServer de este geovisor está desactivada'), { status: 503 });
  }
  // Revalidado acá (no solo al crear/editar la conexión) -- el DNS de un
  // dominio puede cambiar después de aprobado (rebinding); esta función es
  // el único punto por el que pasa CADA petición real del proxy, tanto del
  // visor público como de la vista previa admin. urlApuntaARedPrivada()
  // cachea por hostname con TTL corto, así que esto no agrega una
  // resolución DNS por cada tile.
  if (await urlApuntaARedPrivada(fila.url)) {
    throw Object.assign(
      new Error('La conexión GeoServer apunta a una red privada/interna -- bloqueada'),
      { status: 502 },
    );
  }
  return {
    id: fila.id,
    url: fila.url,
    tipo: fila.tipo,
    usuarioLectura: fila.usuario_lectura,
    // externo puede no tener credenciales -- geoserver.connector.js solo manda
    // Authorization cuando ambas están presentes (ver solicitarConTimeout()).
    passwordDescifrada: fila.password_cifrado ? decryptGeoserverPassword(fila.password_cifrado) : null,
    timeoutMs: fila.timeout_ms,
  };
}

/**
 * Proxy WMS GetMap directo por conexión — para la vista previa en vivo del
 * constructor de geovisores, ANTES de que exista un geovisor guardado (sin
 * slug todavía no hay a qué atar proxyWmsDeGeovisor). Sin restricción de
 * capas: quien llega aquí ya tiene permiso de módulo 'geovisores' editar
 * (ver requireModulo en conexionesGeoserver.routes.js), así que puede
 * previsualizar cualquier capa de cualquier workspace de la conexión —
 * la restricción por workspace solo aplica al geovisor ya publicado.
 */
export async function proxyWmsDeConexion(id, queryParams, geometriaFiltro) {
  const conexion = await obtenerConexionParaConector(id);
  return geoserver.proxyWms(conexion, queryParams, geometriaFiltro);
}

/** Proxy WMS GetLegendGraphic directo por conexión — mismo uso que proxyWmsDeConexion. */
export async function proxyLeyendaDeConexion(id, capaId) {
  const conexion = await obtenerConexionParaConector(id);
  return geoserver.proxyLeyenda(conexion, capaId);
}
