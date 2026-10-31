import { fuente, condicionesTerritorio } from './comun.js';
import { condicionesEspecie, condicionesRegistro } from './filtros.js';

/**
 * FROM + WHERE de una consulta con TODOS los filtros comunes, para el corte activo del grupo.
 * Individuales: territorio, especie y registro. Agregados: territorio y especie (el llamador ya validó el resto).
 * `omitir` quita filtros concretos (p. ej. el del propio campo en /opciones).
 */
export function alcance(ctx, lote, filtros, omitir = []) {
  const f = fuente(lote, ctx);
  const donde = [f.condicionLote, ...condicionesTerritorio(ctx, filtros, f.codigo), ...condicionesEspecie(ctx, filtros, omitir)];
  if (lote.metodo === 'individual') donde.push(...condicionesRegistro(ctx, filtros, omitir));
  return { desde: f.desde, where: donde.join(' AND '), codigo: f.codigo };
}
