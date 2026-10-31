import {
  conLimite, loteActivo, crearContexto, condicionesTerritorio,
} from './comun.js';
import { alcance } from './alcance.js';
import { RANGOS, FILTROS_ESPECIE, FILTROS_FUENTE, filtrosActivos } from './filtros.js';
import { plegarSql, patronBusqueda } from './texto.js';
import { validarInventario, CRUCE_FUENTE_ESPECIE } from './reglas_inventario.js';
import { ConsultaInvalida } from '../biodiversidad.errores.js';


/**
 * Filtros que NO se aplican al listar un campo: el propio (para poder cambiarlo) y los de jerarquía inferior,
 * incluida la especie (si se cambia el orden, la familia elegida deja de ser válida). Conservación, año, fuente y
 * territorio no son jerárquicos: siempre se aplican. `buscar` es el texto sobre las opciones.
 */
function filtrosOmitidos(campo) {
  const i = RANGOS.indexOf(campo === 'orden' ? 'orden_taxon' : campo);
  if (i >= 0) return [...RANGOS.slice(i), 'especie_clave', 'buscar'];
  const propios = {
    entidad: ['entidad_clave', 'dataset_key', 'buscar'],
    conjunto: ['dataset_key', 'buscar'],
    tipo_evidencia: ['tipo_evidencia', 'buscar'],
    anio: ['anio_desde', 'anio_hasta', 'buscar'],
  };
  return propios[campo];
}

const clausulaBuscar = (ctx, columna, buscar) => (buscar != null ? ` AND ${plegarSql(columna)} LIKE ${ctx.p(patronBusqueda(buscar))} ESCAPE '\\'` : '');

/** Cómo se agrupa cada campo en grupos individuales: valor, etiqueta y tablas extra. */
const CAMPOS_INDIVIDUAL = {
  entidad: { valor: 'e.clave', nombre: 'e.nombre', unir: 'JOIN biodiversidad.conjunto cj ON cj.clave = v.dataset_key JOIN biodiversidad.entidad e ON e.clave = cj.entidad_clave' },
  conjunto: { valor: 'cj.clave', nombre: 'cj.titulo', unir: 'JOIN biodiversidad.conjunto cj ON cj.clave = v.dataset_key' },
  tipo_evidencia: { valor: 'v.tipo_evidencia', nombre: 'v.tipo_evidencia', unir: '' },
  anio: { valor: 'v.anio::text', nombre: 'v.anio::text', unir: '' },
};
const campoTaxon = (campo) => ({ valor: `t.${campo}`, nombre: `t.${campo}`, unir: '' });

function sqlIndividual(ctx, lote, filtros, campo) {
  const def = CAMPOS_INDIVIDUAL[campo] ?? campoTaxon(campo);
  const { desde, where } = alcance(ctx, lote, filtros, filtrosOmitidos(campo));
  const filtroTexto = clausulaBuscar(ctx, def.nombre, filtros.buscar);
  return `SELECT ${def.valor} AS valor, min(${def.nombre}) AS nombre, count(DISTINCT v.gbif_id)::int AS registros
            ${desde} ${def.unir} WHERE ${where} AND ${def.valor} IS NOT NULL${filtroTexto} GROUP BY ${def.valor}`;
}

function sqlTaxonInventario(ctx, lote, filtros, campo) {
  const { desde, where } = alcance(ctx, lote, filtros, filtrosOmitidos(campo));
  const filtroTexto = clausulaBuscar(ctx, `t.${campo}`, filtros.buscar);
  return `SELECT t.${campo} AS valor, t.${campo} AS nombre, sum(ie.registros)::int AS registros
            ${desde} WHERE ${where} AND t.${campo} IS NOT NULL${filtroTexto} GROUP BY t.${campo}`;
}

/** Entidad/conjunto de un inventario agregado: salen de conteo_fuente, solo con territorio. */
function sqlFuenteInventario(ctx, lote, filtros, campo) {
  const esEntidad = campo === 'entidad';
  const valor = esEntidad ? 'e.clave' : 'cj.clave';
  const nombre = esEntidad ? 'e.nombre' : 'cj.titulo';
  const donde = [`cf.lote_id = ${ctx.p(lote.id)}`, ...condicionesTerritorio(ctx, filtros, 'cf.codigo')];
  if (!esEntidad && filtros.entidad_clave != null) donde.push(`cj.entidad_clave = ${ctx.p(filtros.entidad_clave)}`);
  return `SELECT ${valor} AS valor, min(${nombre}) AS nombre, sum(cf.registros)::int AS registros
            FROM biodiversidad.conteo_fuente cf
            JOIN biodiversidad.resumen_territorial s ON s.lote_id = cf.lote_id AND s.codigo = cf.codigo
            JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo
            JOIN biodiversidad.conjunto cj ON cj.clave = cf.dataset_key
            JOIN biodiversidad.entidad e ON e.clave = cj.entidad_clave
           WHERE ${donde.join(' AND ')}${clausulaBuscar(ctx, nombre, filtros.buscar)} GROUP BY ${valor}`;
}

/** Año o tipo de evidencia de un inventario agregado: facetas del municipio, solo con territorio. */
function sqlFacetaInventario(ctx, lote, filtros, campo) {
  const faceta = campo === 'anio' ? 'anio' : 'tipo_evidencia';
  const donde = [`f.lote_id = ${ctx.p(lote.id)}`, `f.faceta = '${faceta}'`, ...condicionesTerritorio(ctx, filtros, 'f.codigo')];
  return `SELECT f.valor AS valor, f.valor AS nombre, sum(f.registros)::int AS registros
            FROM biodiversidad.faceta_municipal f
            JOIN biodiversidad.resumen_territorial s ON s.lote_id = f.lote_id AND s.codigo = f.codigo
            JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo
           WHERE ${donde.join(' AND ')}${clausulaBuscar(ctx, 'f.valor', filtros.buscar)} GROUP BY f.valor`;
}

function sqlInventario(ctx, lote, filtros, campo) {
  if (campo === 'entidad' || campo === 'conjunto') {
    // Entidad/conjunto no se cruza con especie; el filtro propio del campo se ignora.
    const propios = campo === 'entidad' ? FILTROS_FUENTE : ['dataset_key'];
    validarInventario(sinCampos(filtros, propios), { fuente: true });
    if (filtrosActivos(filtros, FILTROS_ESPECIE.filter((n) => n !== 'buscar')).length) throw new ConsultaInvalida(CRUCE_FUENTE_ESPECIE);
    return sqlFuenteInventario(ctx, lote, filtros, campo);
  }
  if (campo === 'anio' || campo === 'tipo_evidencia') {
    const propios = campo === 'anio' ? ['anio_desde', 'anio_hasta'] : ['tipo_evidencia'];
    validarInventario(sinCampos(filtros, propios), { soloTerritorio: true });
    return sqlFacetaInventario(ctx, lote, filtros, campo);
  }
  validarInventario(sinCampos(filtros, []));
  return sqlTaxonInventario(ctx, lote, filtros, campo);
}

const sinCampos = (filtros, nombres) => Object.fromEntries(Object.entries(filtros).filter(([k]) => !nombres.includes(k) && k !== 'buscar'));

export async function opciones(filtros) {
  const { campo, limite } = filtros;
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    const ctx = crearContexto();
    const sql = lote.metodo === 'individual' ? sqlIndividual(ctx, lote, filtros, campo) : sqlInventario(ctx, lote, filtros, campo);
    const { rows } = await client.query(
      `SELECT valor, nombre, registros FROM (${sql}) x ORDER BY registros DESC, nombre ASC, valor ASC LIMIT ${ctx.p(limite)}`, ctx.params);
    return { grupo: lote.grupo, campo, valores: rows };
  });
}
