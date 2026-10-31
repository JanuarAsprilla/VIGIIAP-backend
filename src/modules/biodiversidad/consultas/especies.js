import {
  conLimite, loteActivo, crearContexto, fuente, condicionesTerritorio, condicionesEspecie, COLUMNAS_CONSERVACION,
} from './comun.js';
import { sqlTieneFoto, PATRON_IMAGEN, PATRON_REFERENCIA } from './fotos.js';
import { fotosPorEspecie, SIN_FOTO } from './especies_fotos.js';
import { ConsultaInvalida } from '../biodiversidad.errores.js';

const ORDENES = {
  registros: 'registros DESC, especie ASC, especie_clave ASC',
  nombre: 'especie ASC, especie_clave ASC',
};

function consultaEspecies(lote, filtros, ctx) {
  const f = fuente(lote, ctx);
  const individual = lote.metodo === 'individual';
  const donde = [
    f.condicionLote, 't.especie_clave IS NOT NULL',
    ...condicionesTerritorio(ctx, filtros, f.codigo), ...condicionesEspecie(ctx, filtros),
  ].join(' AND ');
  const registros = individual ? 'count(DISTINCT v.gbif_id)' : 'sum(ie.registros)';
  // con_foto (solo individuales): la especie debe tener al menos un registro del alcance con foto válida.
  const conFoto = filtros.con_foto
    ? `HAVING bool_or(${sqlTieneFoto('v.fotos', ctx.p(PATRON_IMAGEN), ctx.p(PATRON_REFERENCIA))})` : '';
  const agrupado = `
    ${f.desde} WHERE ${donde}
    GROUP BY t.especie_clave, ec.amenaza_orden, ec.endemica_colombia, ec.endemica_choco, ec.introducida, ec.invasora
    ${conFoto}`;
  return {
    seleccion: `
      SELECT t.especie_clave, min(t.especie) AS especie, min(t.reino) AS reino, min(t.clase) AS clase,
             min(t.orden) AS orden, min(t.familia) AS familia, min(t.genero) AS genero,
             ${registros}::int AS registros, count(DISTINCT ${f.codigo})::int AS municipios,
             ${COLUMNAS_CONSERVACION},
             count(*) OVER ()::int AS total
      ${agrupado}`,
    conteo: `SELECT count(*)::int AS n FROM (SELECT 1 ${agrupado}) x`,
  };
}

/** Especies del alcance (individuales desde registros, agregados desde el inventario), paginadas. */
export async function especies(filtros) {
  const { pagina, tamano, orden } = filtros;
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    if (filtros.con_foto && lote.metodo !== 'individual') {
      throw new ConsultaInvalida('con_foto no aplica a grupos con inventario agregado: no hay registros individuales con foto.');
    }
    const ctx = crearContexto();
    const { seleccion, conteo } = consultaEspecies(lote, filtros, ctx);
    const { rows } = await client.query(
      `${seleccion} ORDER BY ${ORDENES[orden]} LIMIT ${ctx.p(tamano)} OFFSET ${ctx.p((pagina - 1) * tamano)}`, ctx.params);
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && pagina > 1) {
      // Página más allá del final: el total no viene en las filas.
      const ctx2 = crearContexto();
      const { conteo: sql } = consultaEspecies(lote, filtros, ctx2);
      total = (await client.query(sql, ctx2.params)).rows[0].n;
    }
    const fotos = await fotosPorEspecie(client, lote, filtros, rows.map((e) => e.especie_clave));
    return {
      grupo: lote.grupo, metodo: lote.metodo, pagina, tamano, total,
      especies: rows.map(({ total: _t, ...e }) => ({ ...e, ...(fotos.get(e.especie_clave) ?? SIN_FOTO) })),
    };
  });
}
