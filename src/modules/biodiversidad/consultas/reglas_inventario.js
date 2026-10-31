import { ConsultaInvalida } from '../biodiversidad.errores.js';
import {
  FILTROS_ESPECIE, FILTROS_FUENTE, FILTROS_REGISTRO, filtrosActivos,
} from './filtros.js';

export const CRUCE_FUENTE_ESPECIE = 'No se puede filtrar a la vez por entidad/conjunto y por especie o taxonomía en grupos de inventario agregado.';
const SOLO_PARCIAL = 'aves, insectos y plantas solo tienen conteos por municipio';

/**
 * Los grupos de inventario agregado no tienen registros individuales: solo se pueden cruzar territorio y
 * especie/taxonomía. Cada ruta declara qué más admite; lo demás responde 422 con una explicación.
 *  - fuente: entidad/conjunto (vienen de `conteo_fuente`, no se cruzan con especie).
 *  - facetas: año y evidencia (vienen de `faceta_municipal`, solo se cruzan con territorio).
 */
export function validarInventario(filtros, { fuente = false, facetas = [], soloTerritorio = false } = {}) {
  const sobrantes = filtrosActivos(filtros, FILTROS_REGISTRO).filter((n) => !FILTROS_FUENTE.includes(n) && !facetas.includes(n));
  if (sobrantes.length) {
    throw new ConsultaInvalida(`${sobrantes.join(', ')}: no aplica a inventario agregado (${SOLO_PARCIAL}).`);
  }
  const deFuente = filtrosActivos(filtros, FILTROS_FUENTE);
  if (deFuente.length && !fuente) {
    throw new ConsultaInvalida(`${deFuente.join(', ')}: en inventario agregado solo se puede filtrar por entidad o conjunto en el mapa por municipio y el resumen.`);
  }
  const deEspecie = filtrosActivos(filtros, FILTROS_ESPECIE);
  if (deFuente.length && deEspecie.length) {
    throw new ConsultaInvalida(CRUCE_FUENTE_ESPECIE);
  }
  if (soloTerritorio && deEspecie.length) {
    throw new ConsultaInvalida(`${deEspecie.join(', ')}: en inventario agregado el año y el tipo de evidencia solo se pueden cruzar con el territorio, no con especie ni taxonomía.`);
  }
}

/** Texto reutilizable: sin entidad ni conjunto, el inventario agregado sí se cruza con taxonomía. */
export const usaFuente = (filtros) => filtrosActivos(filtros, FILTROS_FUENTE).length > 0;
