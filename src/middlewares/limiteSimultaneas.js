const POR_DEFECTO = 4;

/** Entero positivo de una variable de entorno; si falta o es inválido, el valor por defecto. */
export function leerTope(valor, porDefecto = POR_DEFECTO) {
  return /^\d{1,4}$/.test(String(valor ?? '')) && Number(valor) > 0 ? Number(valor) : porDefecto;
}

/**
 * Tope de peticiones en vuelo por IP (en memoria, por instancia): una sola IP no agota el pool de conexiones
 * del Observatorio. El cupo se libera siempre al terminar, cortarse la conexión o fallar la respuesta.
 */
export function limiteSimultaneasPorIp({ tope = leerTope(process.env.BIODIVERSIDAD_MAX_SIMULTANEAS_IP), mensaje, reintentarEn = 3 } = {}) {
  const enCurso = new Map();
  const liberar = (ip) => {
    const quedan = (enCurso.get(ip) ?? 1) - 1;
    if (quedan <= 0) enCurso.delete(ip);
    else enCurso.set(ip, quedan);
  };
  const middleware = (req, res, next) => {
    const ip = req.ip ?? 'desconocida';
    if ((enCurso.get(ip) ?? 0) >= tope) {
      res.set('Retry-After', String(reintentarEn));
      return res.status(503).json({ error: mensaje });
    }
    enCurso.set(ip, (enCurso.get(ip) ?? 0) + 1);
    let liberada = false;
    const soltar = () => {
      if (liberada) return;
      liberada = true;
      liberar(ip);
    };
    res.once('finish', soltar);
    res.once('close', soltar);
    res.once('error', soltar);
    return next();
  };
  middleware.enCurso = () => enCurso.size;
  return middleware;
}
