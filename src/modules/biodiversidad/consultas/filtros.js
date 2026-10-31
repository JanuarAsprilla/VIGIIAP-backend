import { plegarSql, patronBusqueda } from './texto.js';
import { sqlTieneFoto, PATRON_IMAGEN, PATRON_REFERENCIA } from './fotos.js';

/** Filtros taxonómicos (de mayor a menor rango) y la columna de `taxon_version` que comparan. */
export const RANGOS = ['reino', 'division', 'clase', 'orden_taxon', 'familia', 'genero'];
export const COLUMNA_RANGO = { reino: 'reino', division: 'division', clase: 'clase', orden_taxon: 'orden', familia: 'familia', genero: 'genero' };
/** Filtros que actúan sobre la especie (alias `t` y `ec`): también valen en los inventarios agregados. */
export const FILTROS_ESPECIE = [...RANGOS, 'especie_clave', 'buscar', 'conservacion', 'amenaza'];
/** Filtros de la procedencia del registro (alias `v`): solo existen en grupos individuales. */
export const FILTROS_FUENTE = ['entidad_clave', 'dataset_key'];
export const FILTROS_REGISTRO = [...FILTROS_FUENTE, 'anio_desde', 'anio_hasta', 'tipo_evidencia', 'con_foto', 'con_ubicacion'];
const FILTROS_TERRITORIO = ['codigo_municipal', 'departamento'];

const ORDEN_AMENAZA = { CR: 1, EN: 2, VU: 3 };
const CONSERVACION = {
  amenazada: 'ec.amenaza_orden IS NOT NULL',
  endemica: '(ec.endemica_colombia OR ec.endemica_choco)',
  introducida: 'ec.introducida',
  invasora: 'ec.invasora',
};
/** Ubicación pública: la vista deja nulas las coordenadas reservadas, y además se exige la marca. */
export const UBICACION_PUBLICA = '(NOT v.coordenadas_ocultas AND v.latitud IS NOT NULL AND v.longitud IS NOT NULL)';

const deRango = (columna) => (p, valor) => `t.${columna} = ${p(valor)}`;
const entidad = (p, valor) => `v.dataset_key IN (SELECT clave FROM biodiversidad.conjunto WHERE entidad_clave = ${p(valor)})`;

/** Cada filtro → su condición SQL. El valor del usuario solo viaja por `p()` (parámetro `$n`), nunca concatenado. */
const REGLAS = {
  reino: deRango('reino'),
  division: deRango('division'),
  clase: deRango('clase'),
  orden_taxon: deRango('orden'),
  familia: deRango('familia'),
  genero: deRango('genero'),
  especie_clave: (p, valor) => `t.especie_clave = ${p(valor)}`,
  buscar: (p, valor) => `${plegarSql('t.especie')} LIKE ${p(patronBusqueda(valor))} ESCAPE '\\'`,
  conservacion: (_p, valor) => CONSERVACION[valor],
  amenaza: (p, valor) => `ec.amenaza_orden = ${p(ORDEN_AMENAZA[valor])}`,
  entidad_clave: entidad,
  dataset_key: (p, valor) => `v.dataset_key = ${p(valor)}`,
  anio_desde: (p, valor) => `v.anio >= ${p(valor)}`,
  anio_hasta: (p, valor) => `v.anio <= ${p(valor)}`,
  tipo_evidencia: (p, valor) => `v.tipo_evidencia = ${p(valor)}`,
  con_foto: (p) => sqlTieneFoto('v.fotos', p(PATRON_IMAGEN), p(PATRON_REFERENCIA)),
  con_ubicacion: () => UBICACION_PUBLICA,
};

function condiciones(ctx, filtros, nombres, omitir) {
  return nombres
    .filter((n) => filtros[n] != null && filtros[n] !== false && !omitir.includes(n))
    .map((n) => REGLAS[n](ctx.p, filtros[n]));
}

/** Taxonomía, especie y conservación (alias `t`, `ec`). */
export const condicionesEspecie = (ctx, filtros, omitir = []) => condiciones(ctx, filtros, FILTROS_ESPECIE, omitir);

/** Procedencia, año, evidencia, foto y ubicación (alias `v`). Solo individuales. */
export const condicionesRegistro = (ctx, filtros, omitir = []) => condiciones(ctx, filtros, FILTROS_REGISTRO, omitir);

const activos = (filtros, nombres) => nombres.filter((n) => filtros[n] != null && filtros[n] !== false);
export const filtrosActivos = (filtros, nombres) => activos(filtros, nombres);
export const hayFiltros = (filtros) => activos(filtros, [...FILTROS_TERRITORIO, ...FILTROS_ESPECIE, ...FILTROS_REGISTRO]).length > 0;
export const hayFiltrosEspecie = (filtros) => activos(filtros, FILTROS_ESPECIE).length > 0;
