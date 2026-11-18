import logger from './logger.js';

const INTERVALO_AVISO_DESCARTE_MS = 10_000;

/**
 * Cola en memoria acotada que entrega los elementos a `vaciarLote` por lotes. `encolar` es síncrona, nunca
 * lanza ni espera a la base de datos; si se llena descarta los más antiguos. Un lote que falla se pierde
 * (se cuenta y se registra) en vez de reintentarse: la analítica no justifica un bucle sobre una fila inválida.
 */
export function crearColaPorLotes({ nombre, vaciarLote, tope, tamanoLote, intervaloMs }) {
  // Búfer interno y encapsulado: copiarlo en cada encolado costaría O(tope) por petición en el camino caliente.
  const pendientes = [];
  let descartados = 0;
  let perdidosPorError = 0;
  let cerrada = false;
  let vaciadoEnCurso = null;
  let ultimoAvisoDescarte = 0;

  async function escribirUnLote() {
    const lote = pendientes.splice(0, tamanoLote);
    try {
      await vaciarLote(lote);
    } catch (err) {
      perdidosPorError += lote.length;
      logger.error(`[cola:${nombre}] No se pudo escribir un lote de ${lote.length}: ${err.message}`);
    }
  }

  async function vaciarTodo() {
    while (pendientes.length > 0) {
      await escribirUnLote();
    }
  }

  function vaciar() {
    if (!vaciadoEnCurso) {
      vaciadoEnCurso = vaciarTodo().finally(() => { vaciadoEnCurso = null; });
    }
    return vaciadoEnCurso;
  }

  function avisarDescarte() {
    const ahora = Date.now();
    if (ahora - ultimoAvisoDescarte < INTERVALO_AVISO_DESCARTE_MS) return;
    ultimoAvisoDescarte = ahora;
    logger.warn(`[cola:${nombre}] Cola llena (${tope}): se descartan los más antiguos. Descartados acumulados: ${descartados}`);
  }

  const temporizador = setInterval(() => { vaciar(); }, intervaloMs);
  temporizador.unref();

  return {
    encolar(elemento) {
      if (cerrada) return false;
      if (pendientes.length >= tope) {
        const sobran = pendientes.length - tope + 1;
        pendientes.splice(0, sobran);
        descartados += sobran;
        avisarDescarte();
      }
      pendientes.push(elemento);
      if (pendientes.length >= tamanoLote) vaciar();
      return true;
    },
    estadisticas: () => ({ pendientes: pendientes.length, descartados, perdidosPorError }),
    async cerrar() {
      cerrada = true;
      clearInterval(temporizador);
      if (vaciadoEnCurso) await vaciadoEnCurso;
      await vaciar();
    },
  };
}
