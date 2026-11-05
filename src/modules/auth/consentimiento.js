/**
 * Prueba de la autorización de tratamiento de datos (Ley 1581 de 2012 y Decreto 1377 de 2013): al aceptar, se guarda
 * cuándo y contra qué texto. La «versión» es una huella del texto vigente de la política y los términos, de modo que
 * cualquier cambio del texto publicado produce otra versión.
 */
import crypto from 'node:crypto';
import { query } from '../../config/database.js';

const CLAVES = ['politicaPrivacidad', 'terminosUso'];

/** Huella corta de los textos publicados; 'predeterminado' si todavía se usan los textos de respaldo del sistema. */
export async function versionVigente() {
  const { rows } = await query('SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])', [CLAVES]);
  const textos = Object.fromEntries(rows.map((r) => [r.clave, (r.valor ?? '').trim()]));
  const contenido = CLAVES.map((c) => textos[c] ?? '').join('\n---\n');
  if (!contenido.replace(/-/g, '').trim()) return 'predeterminado';
  return crypto.createHash('sha256').update(contenido).digest('hex').slice(0, 16);
}

/** Registra que la persona aceptó, con la fecha del servidor y la versión de los textos vigentes. */
export async function registrarConsentimiento(usuarioId) {
  const version = await versionVigente();
  await query(
    'UPDATE usuarios SET terminos_aceptados_en = NOW(), terminos_version = $1 WHERE id = $2',
    [version, usuarioId],
  );
  return version;
}
