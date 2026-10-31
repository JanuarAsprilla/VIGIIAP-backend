import { conLimite, loteActivo } from './comun.js';

const ESPECIES_INDIVIDUALES = `
  SELECT a.codigo, count(DISTINCT v.especie_clave)::int AS especies
    FROM biodiversidad.vw_registro_publico v
    JOIN biodiversidad.asignacion a ON a.lote_id = v.lote_id AND a.gbif_id = v.gbif_id
   WHERE v.lote_id = $1 AND v.especie_clave IS NOT NULL
   GROUP BY a.codigo`;

const ESPECIES_AGREGADAS = `
  SELECT ie.codigo, count(DISTINCT t.especie_clave)::int AS especies
    FROM biodiversidad.inventario_especie ie
    JOIN biodiversidad.taxon_version t ON t.huella = ie.taxon_huella
   WHERE ie.lote_id = $1 AND t.especie_clave IS NOT NULL
   GROUP BY ie.codigo`;

export async function municipios(grupo) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, grupo);
    if (!lote) return null;
    const { rows } = await client.query(
      `SELECT s.codigo AS codigo_municipal, m.nombre AS municipio, m.departamento,
              s.registros::int AS registros, s.sin_especie::int AS sin_especie
         FROM biodiversidad.resumen_territorial s
         JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo
        WHERE s.lote_id = $1
        ORDER BY m.departamento, m.nombre`, [lote.id]);
    const { rows: conteos } = await client.query(
      lote.metodo === 'individual' ? ESPECIES_INDIVIDUALES : ESPECIES_AGREGADAS, [lote.id]);
    const especiesPor = new Map(conteos.map((c) => [c.codigo, c.especies]));
    return {
      grupo: lote.grupo, metodo: lote.metodo, desde: lote.desde, hasta: lote.hasta,
      municipios: rows.map((r) => ({ ...r, especies: especiesPor.get(r.codigo_municipal) ?? 0 })),
    };
  });
}
