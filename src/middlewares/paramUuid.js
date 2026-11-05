const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validador para `router.param('id', paramUuid)`: un id que no es UUID no existe, así que responde 404
 * sin consultar la base. Evita que Postgres rechace el valor (22P02) y que cada cadena distinta se
 * convierta en un error 500 registrado y notificado.
 */
export function paramUuid(_req, res, next, valor) {
  if (!UUID_RE.test(String(valor))) {
    return res.status(404).json({ error: 'Recurso no encontrado' });
  }
  return next();
}
