const MAX_ENTRADAS_POR_DEFECTO = 50;

/**
 * Memoriza una función asíncrona en memoria del proceso durante `ttlMs`.
 * Las llamadas simultáneas con los mismos argumentos comparten una sola ejecución y los
 * errores no se guardan. Con `ttlMs` en 0 se desactiva por completo.
 */
export function memoizar(fn, ttlMs, { ahora = Date.now, maxEntradas = MAX_ENTRADAS_POR_DEFECTO } = {}) {
  if (!(ttlMs > 0)) return fn;
  const entradas = new Map();

  return async (...args) => {
    const clave = JSON.stringify(args);
    const guardada = entradas.get(clave);
    if (guardada?.pendiente) return guardada.pendiente;
    if (guardada && guardada.expira > ahora()) return guardada.valor;

    const pendiente = Promise.resolve(fn(...args)).then(
      (valor) => {
        entradas.delete(clave);
        entradas.set(clave, { valor, expira: ahora() + ttlMs });
        if (entradas.size > maxEntradas) entradas.delete(entradas.keys().next().value);
        return valor;
      },
      (error) => {
        entradas.delete(clave);
        throw error;
      },
    );
    entradas.set(clave, { pendiente });
    return pendiente;
  };
}
