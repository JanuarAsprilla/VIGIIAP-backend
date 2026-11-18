import { redactarUrl } from '../../utils/redactarUrl.js';

/** Una ruta se guarda sin consulta ni fragmento (pueden llevar credenciales) y con los tokens tapados. */
export function redactarRuta(ruta) {
  if (ruta == null) return ruta;
  return redactarUrl(String(ruta).split(/[?#]/)[0]);
}

export function redactarTexto(valor) {
  return valor == null ? valor : redactarUrl(valor);
}

/**
 * Redacta las rutas de filas ya guardadas y suma las que quedan iguales (p. ej. muchos tokens distintos
 * pasan a ser una sola fila). Devuelve filas nuevas, ordenadas de mayor a menor por `campoOrden`.
 */
export function fusionarRutas(filas, camposRuta, campoOrden) {
  const fusionadas = new Map();
  for (const fila of filas) {
    const limpia = { ...fila };
    camposRuta.forEach((c) => { limpia[c] = redactarRuta(fila[c]); });
    const clave = camposRuta.map((c) => limpia[c]).join('\u0000');
    const previa = fusionadas.get(clave);
    if (!previa) { fusionadas.set(clave, limpia); continue; }
    const suma = { ...previa };
    for (const [k, v] of Object.entries(limpia)) {
      if (!camposRuta.includes(k) && typeof v === 'number') suma[k] = (previa[k] ?? 0) + v;
    }
    fusionadas.set(clave, suma);
  }
  return [...fusionadas.values()].sort((a, b) => b[campoOrden] - a[campoOrden]);
}
