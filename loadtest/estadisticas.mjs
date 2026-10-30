/** Percentil por rango más cercano; no modifica el arreglo recibido. */
export function percentil(muestras, p) {
  if (!muestras.length) return 0;
  const ordenadas = [...muestras].sort((a, b) => a - b);
  const posicion = Math.max(1, Math.ceil((p / 100) * ordenadas.length));
  return ordenadas[posicion - 1];
}

/** 429 (límite de tasa) se cuenta aparte de los errores: indica configuración, no fallo del servicio. */
export function resumir({ latencias, estados, duracionSeg }) {
  const total = estados.length;
  const limitadas = estados.filter((e) => e === 429).length;
  const errores = estados.filter((e) => e === 0 || e >= 500).length;
  return {
    total,
    rps: duracionSeg > 0 ? total / duracionSeg : 0,
    p50: percentil(latencias, 50),
    p95: percentil(latencias, 95),
    p99: percentil(latencias, 99),
    max: latencias.reduce((mayor, valor) => (valor > mayor ? valor : mayor), 0),
    limitadas,
    errores,
    tasaError: total ? errores / total : 0,
  };
}

export function evaluarUmbrales(resumen, { p95Ms, tasaErrorMax }) {
  const fallos = [];
  if (resumen.p95 > p95Ms) fallos.push(`p95 ${resumen.p95.toFixed(0)} ms supera el umbral de ${p95Ms} ms`);
  if (resumen.tasaError > tasaErrorMax) {
    fallos.push(`tasa de error ${(resumen.tasaError * 100).toFixed(2)} % supera el umbral de ${(tasaErrorMax * 100).toFixed(2)} %`);
  }
  return { aprobado: fallos.length === 0, fallos };
}

/** Selección ponderada: `azar` en [0, 1) recorre los pesos acumulados. */
export function elegirRuta(rutas, azar) {
  const total = rutas.reduce((suma, r) => suma + r.peso, 0);
  let acumulado = 0;
  for (const ruta of rutas) {
    acumulado += ruta.peso / total;
    if (azar < acumulado) return ruta;
  }
  return rutas[rutas.length - 1];
}
