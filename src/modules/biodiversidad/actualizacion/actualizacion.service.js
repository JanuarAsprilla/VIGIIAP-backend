/**
 * Actualización automática de los datos de biodiversidad: ajustes, credenciales de GBIF de quien se designe,
 * solicitudes manuales y bitácora de ejecuciones.
 *
 * Esta capa nunca habla con GBIF ni ejecuta descargas: solo administra la configuración y el estado. Quien ejecuta
 * es el proceso aislado (scripts/biodiversidad/actualizar.js, lanzado por el workflow) que usa `pendientes`,
 * `iniciar` y `registrar`. La clave de GBIF se guarda cifrada y ninguna función de este archivo la devuelve.
 */
import { query } from '../../../config/database.js';
import { cifrarClaveGbif, cifradoDisponible } from '../../../utils/biodiversidadEncryption.js';

export const TAREAS = ['fotos', 'frescura', 'datos'];
export const ESTADOS_FINALES = ['ok', 'error', 'omitida'];
const HORAS_MAX_EN_CURSO = 6;
const MAX_RESUMEN_BYTES = 20_000;

const fallo = (status, mensaje, codigo) => Object.assign(new Error(mensaje), { status, codigo });

/** La fila única de ajustes la siembra la migración; si falta (p. ej. un TRUNCATE de usuarios en cascada) se recrea con los valores por defecto. */
async function leerAjustes() {
  await query('INSERT INTO bio_actualizacion_ajustes (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  const { rows: [a] } = await query(
    `SELECT a.modo, a.activa, a.frecuencia_dias, a.credencial_usuario_id, a.actualizado_en,
            u.nombre AS credencial_nombre
       FROM bio_actualizacion_ajustes a LEFT JOIN usuarios u ON u.id = a.credencial_usuario_id WHERE a.id = 1`);
  return a;
}

/** Estado completo para el panel. Las credenciales de otras personas solo las ve el super administrador. */
export async function estado({ usuarioId, esSuperAdmin }) {
  const [ajustes, credenciales, ultimas, cortes] = await Promise.all([
    leerAjustes(),
    query(
      `SELECT c.usuario_id, u.nombre, u.email, c.gbif_usuario, c.gbif_correo, c.actualizado_en
         FROM bio_actualizacion_credenciales c JOIN usuarios u ON u.id = c.usuario_id
        ${esSuperAdmin ? '' : 'WHERE c.usuario_id = $1'} ORDER BY u.nombre`, esSuperAdmin ? [] : [usuarioId]),
    query(
      `SELECT DISTINCT ON (tarea) id, tarea, disparador, estado, resumen, creado_en, inicio, fin
         FROM bio_actualizacion_ejecuciones ORDER BY tarea, creado_en DESC`),
    query(
      `SELECT grupo, desde, hasta, fecha_fuente, registros FROM biodiversidad.lote
        WHERE activo AND estado = 'completo' ORDER BY grupo`),
  ]);
  return {
    ajustes,
    cifrado_disponible: cifradoDisponible(),
    credenciales: credenciales.rows,
    ultimas_ejecuciones: ultimas.rows,
    cortes: cortes.rows,
  };
}

export async function listarEjecuciones(limite = 30) {
  const { rows } = await query(
    `SELECT e.id, e.tarea, e.disparador, e.estado, e.resumen, e.creado_en, e.inicio, e.fin, u.nombre AS solicitado_por
       FROM bio_actualizacion_ejecuciones e LEFT JOIN usuarios u ON u.id = e.solicitado_por
      ORDER BY e.creado_en DESC LIMIT $1`, [Math.min(Math.max(Number(limite) || 30, 1), 100)]);
  return rows;
}

/** Solo super administrador. El modo «cuenta» exige que la persona elegida ya tenga su credencial guardada. */
export async function actualizarAjustes(actorId, { modo, activa, frecuencia_dias: frecuencia, credencial_usuario_id: credencial }) {
  const actual = await leerAjustes();
  const siguiente = {
    modo: modo ?? actual.modo,
    activa: activa ?? actual.activa,
    frecuencia_dias: frecuencia ?? actual.frecuencia_dias,
    credencial_usuario_id: credencial === undefined ? actual.credencial_usuario_id : credencial,
  };
  if (siguiente.modo === 'cuenta') {
    if (!siguiente.credencial_usuario_id) throw fallo(422, 'El modo con cuenta de GBIF necesita designar a la persona que la aporta', 'sin_responsable');
    const { rowCount } = await query('SELECT 1 FROM bio_actualizacion_credenciales WHERE usuario_id = $1', [siguiente.credencial_usuario_id]);
    if (rowCount === 0) throw fallo(422, 'La persona designada todavía no ha guardado su cuenta de GBIF', 'sin_credencial');
  }
  await query(
    `UPDATE bio_actualizacion_ajustes
        SET modo = $1, activa = $2, frecuencia_dias = $3, credencial_usuario_id = $4, actualizado_por = $5, actualizado_en = now()
      WHERE id = 1`,
    [siguiente.modo, siguiente.activa, siguiente.frecuencia_dias, siguiente.credencial_usuario_id, actorId]);
  return { antes: actual, despues: siguiente };
}

/** La clave se cifra antes de tocar la base de datos; sin BIODIVERSIDAD_ENCRYPTION_KEY responde 503 y no guarda nada. */
export async function guardarCredencial(usuarioId, { gbif_usuario: usuario, gbif_correo: correo, clave }) {
  const cifrada = cifrarClaveGbif(clave);
  const { rowCount } = await query('SELECT 1 FROM usuarios WHERE id = $1 AND activo', [usuarioId]);
  if (rowCount === 0) throw fallo(404, 'Usuario no encontrado', 'usuario_inexistente');
  await query(
    `INSERT INTO bio_actualizacion_credenciales (usuario_id, gbif_usuario, gbif_correo, clave_cifrada)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario_id) DO UPDATE
       SET gbif_usuario = EXCLUDED.gbif_usuario, gbif_correo = EXCLUDED.gbif_correo,
           clave_cifrada = EXCLUDED.clave_cifrada, actualizado_en = now()`,
    [usuarioId, usuario, correo, cifrada]);
}

/** Si la credencial borrada era la de las ejecuciones automáticas, el sistema vuelve al modo sin cuenta. */
export async function borrarCredencial(usuarioId) {
  const { rowCount } = await query('DELETE FROM bio_actualizacion_credenciales WHERE usuario_id = $1', [usuarioId]);
  if (rowCount === 0) throw fallo(404, 'No hay credencial guardada', 'sin_credencial');
  await query(
    `UPDATE bio_actualizacion_ajustes SET modo = 'publico', credencial_usuario_id = NULL, actualizado_en = now()
      WHERE id = 1 AND credencial_usuario_id = $1`, [usuarioId]);
}

/** Pide una ejecución ahora. Una sola pendiente por tarea; «datos» solo existe en el modo con cuenta. */
export async function solicitar(actorId, tarea) {
  if (!TAREAS.includes(tarea)) throw fallo(422, 'Tarea desconocida', 'tarea_invalida');
  if (tarea === 'datos') {
    const ajustes = await leerAjustes();
    if (ajustes.modo !== 'cuenta') throw fallo(409, 'La actualización completa de datos requiere el modo con cuenta de GBIF', 'requiere_cuenta');
  }
  const { rows } = await query(
    `INSERT INTO bio_actualizacion_ejecuciones (tarea, disparador, solicitado_por) VALUES ($1, 'manual', $2)
     ON CONFLICT DO NOTHING RETURNING id, tarea, estado, creado_en`, [tarea, actorId]);
  if (rows.length === 0) throw fallo(409, 'Ya hay una solicitud o ejecución en curso de esta tarea', 'ya_pendiente');
  return rows[0];
}

// ── Lo que usa el proceso aislado (scripts/biodiversidad/actualizar.js) ───────────────────────────

/**
 * Cierra ejecuciones que quedaron «en curso» (proceso caído), crea las programadas que ya tocan y devuelve lo que
 * hay por ejecutar. Una tarea toca si no tuvo una ejecución ok u omitida dentro de la frecuencia configurada;
 * si la última falló, vuelve a tocar en la siguiente revisión.
 */
export async function pendientes() {
  await query(
    `UPDATE bio_actualizacion_ejecuciones
        SET estado = 'error', fin = now(), resumen = resumen || '{"motivo":"el proceso no respondió"}'::jsonb
      WHERE estado = 'en_curso' AND inicio < now() - make_interval(hours => $1)`, [HORAS_MAX_EN_CURSO]);
  const ajustes = await leerAjustes();
  if (ajustes.activa) {
    for (const tarea of ajustes.modo === 'cuenta' ? TAREAS : TAREAS.filter((t) => t !== 'datos')) {
      await query(
        `INSERT INTO bio_actualizacion_ejecuciones (tarea, disparador)
         SELECT $1, 'programada'
          WHERE NOT EXISTS (SELECT 1 FROM bio_actualizacion_ejecuciones
                             WHERE tarea = $1 AND estado IN ('ok', 'omitida') AND creado_en > now() - make_interval(days => $2))
         ON CONFLICT DO NOTHING`, [tarea, ajustes.frecuencia_dias]);
    }
  }
  const { rows } = await query(
    `SELECT id, tarea, disparador FROM bio_actualizacion_ejecuciones WHERE estado = 'solicitada' ORDER BY id`);
  return rows;
}

/**
 * Compara los conteos de hoy de GBIF con la línea base (la primera medición) y estima cuánto han crecido.
 * Sin línea base, esta medición pasa a serlo. Solo cuentan enteros no negativos; lo demás se ignora.
 */
export function calcularFrescura(actual, base = null) {
  const limpio = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => Number.isInteger(v) && v >= 0));
  const hoy = limpio(actual);
  const referencia = base ? limpio(base) : hoy;
  const grupos = {};
  for (const [grupo, gbif] of Object.entries(hoy)) {
    const inicial = referencia[grupo];
    grupos[grupo] = {
      gbif,
      base: inicial ?? gbif,
      crecimiento_pct: inicial > 0 ? Math.round(((gbif - inicial) / inicial) * 1000) / 10 : 0,
    };
  }
  return { linea_base: !base, grupos };
}

/** Conteos de la primera medición de frescura exitosa (la línea base), o null si aún no hay. */
export async function lineaBaseFrescura() {
  const { rows } = await query(
    `SELECT resumen FROM bio_actualizacion_ejecuciones WHERE tarea = 'frescura' AND estado = 'ok' AND resumen ? 'grupos'
      ORDER BY creado_en ASC LIMIT 1`);
  if (rows.length === 0) return null;
  return Object.fromEntries(Object.entries(rows[0].resumen.grupos).map(([g, v]) => [g, v.base]));
}

export async function iniciar(id) {
  const { rows } = await query(
    `UPDATE bio_actualizacion_ejecuciones SET estado = 'en_curso', inicio = now()
      WHERE id = $1 AND estado = 'solicitada' RETURNING id, tarea`, [id]);
  if (rows.length === 0) throw fallo(409, 'La ejecución no está pendiente', 'no_pendiente');
  return rows[0];
}

export async function registrar(id, estadoFinal, resumen = {}) {
  if (!ESTADOS_FINALES.includes(estadoFinal)) throw fallo(422, 'Estado final inválido', 'estado_invalido');
  const texto = JSON.stringify(resumen && typeof resumen === 'object' && !Array.isArray(resumen) ? resumen : {});
  if (Buffer.byteLength(texto) > MAX_RESUMEN_BYTES) throw fallo(422, 'Resumen demasiado grande', 'resumen_grande');
  const { rows } = await query(
    `UPDATE bio_actualizacion_ejecuciones SET estado = $2, fin = now(), resumen = $3::jsonb
      WHERE id = $1 AND estado = 'en_curso' RETURNING id, tarea, estado`, [id, estadoFinal, texto]);
  if (rows.length === 0) throw fallo(409, 'La ejecución no está en curso', 'no_en_curso');
  return rows[0];
}
