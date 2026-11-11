import { query } from '../../config/database.js';

export const FORMATOS = Object.freeze(['pdf', 'xlsx', 'csv']);

/** Las sesiones de visitante y público no son una cuenta: «con sesión» significa una cuenta real. */
const ROLES_SIN_CUENTA = new Set(['visitante', 'publico']);

const COLUMNAS_GENERAL = `institucion, subtitulo, pie, aviso, color_primario, color_acento, logo_url, acceso, formatos, actualizado_en`;
const CAMPOS_GENERAL = ['institucion', 'subtitulo', 'pie', 'aviso', 'color_primario', 'color_acento', 'acceso', 'formatos'];
const CAMPOS_HERRAMIENTA = ['activo', 'formatos', 'max_filas'];

export function tieneCuenta(user) {
  return Boolean(user) && !ROLES_SIN_CUENTA.has(user.rol);
}

/** Regla única de quién puede descargar; las rutas de exportación de cada herramienta deben usarla también en el servidor. */
export function accesoPermitido(acceso, user) {
  return acceso === 'publico' || tieneCuenta(user);
}

export async function obtenerGeneral() {
  const { rows } = await query(`SELECT ${COLUMNAS_GENERAL} FROM informes_config WHERE id = 1`);
  return rows[0];
}

function asignaciones(cambios, permitidos, primerParametro) {
  const entradas = Object.entries(cambios).filter(([campo]) => permitidos.includes(campo));
  if (entradas.length === 0) {
    throw Object.assign(new Error('No hay campos válidos para actualizar'), { status: 400 });
  }
  return {
    campos: entradas.map(([campo]) => campo),
    sql: entradas.map(([campo], i) => `${campo} = $${i + primerParametro}`).join(', '),
    valores: entradas.map(([, valor]) => valor),
  };
}

export async function actualizarGeneral(cambios) {
  const { sql, valores } = asignaciones(cambios, CAMPOS_GENERAL, 1);
  const { rows } = await query(
    `UPDATE informes_config SET ${sql}, actualizado_en = NOW() WHERE id = 1 RETURNING ${COLUMNAS_GENERAL}`,
    valores,
  );
  return rows[0];
}

/** Guarda la URL del logo (o la quita con null) y devuelve la anterior para que quien llama borre el archivo viejo. */
export async function fijarLogo(url) {
  const { rows: previo } = await query('SELECT logo_url FROM informes_config WHERE id = 1');
  await query('UPDATE informes_config SET logo_url = $1, actualizado_en = NOW() WHERE id = 1', [url]);
  return previo[0]?.logo_url ?? null;
}

export async function listarHerramientas() {
  const { rows } = await query(
    `SELECT t.clave, t.titulo, COALESCE(i.activo, false) AS activo, i.formatos, COALESCE(i.max_filas, 5000) AS max_filas,
            (i.herramienta IS NOT NULL) AS configurada
     FROM herramientas t LEFT JOIN informes_herramienta i ON i.herramienta = t.clave
     WHERE t.deleted_at IS NULL
     ORDER BY t.orden ASC, t.clave ASC`,
  );
  return rows;
}

/** Crea o actualiza los ajustes de informe de una herramienta existente. null si la herramienta no existe. */
export async function actualizarHerramienta(clave, cambios) {
  const { rows: existe } = await query('SELECT 1 FROM herramientas WHERE clave = $1 AND deleted_at IS NULL', [clave]);
  if (existe.length === 0) return null;

  const { campos, sql, valores } = asignaciones(cambios, CAMPOS_HERRAMIENTA, 2);
  const { rows } = await query(
    `INSERT INTO informes_herramienta (herramienta, ${campos.join(', ')})
     VALUES ($1, ${campos.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (herramienta) DO UPDATE SET ${sql}, actualizado_en = NOW()
     RETURNING herramienta AS clave, activo, formatos, max_filas`,
    [clave, ...valores],
  );
  return rows[0];
}

/**
 * Lo que necesita el botón «Descargar informe» de una herramienta: si existe, qué formatos ofrece, si esta persona
 * puede descargar y la plantilla del informe. null si la herramienta no existe o está oculta.
 */
export async function configuracionPublica(clave, user) {
  const { rows } = await query(
    `SELECT g.institucion, g.subtitulo, g.pie, g.aviso, g.color_primario, g.color_acento, g.logo_url, g.acceso,
            g.formatos AS formatos_generales, i.activo, i.formatos AS formatos_herramienta, i.max_filas
     FROM herramientas t
     CROSS JOIN informes_config g
     LEFT JOIN informes_herramienta i ON i.herramienta = t.clave
     WHERE t.clave = $1 AND t.deleted_at IS NULL AND t.activa = true`,
    [clave],
  );
  const fila = rows[0];
  if (!fila) return null;

  const habilitado = fila.activo === true;
  const puedeDescargar = habilitado && accesoPermitido(fila.acceso, user);
  return {
    habilitado,
    puedeDescargar,
    requiereSesion: fila.acceso === 'usuarios',
    formatos: habilitado ? (fila.formatos_herramienta ?? fila.formatos_generales) : [],
    maxFilas: fila.max_filas ?? 5000,
    plantilla: {
      institucion: fila.institucion,
      subtitulo: fila.subtitulo,
      pie: fila.pie,
      aviso: fila.aviso,
      colorPrimario: fila.color_primario,
      colorAcento: fila.color_acento,
      logoUrl: fila.logo_url,
    },
  };
}
