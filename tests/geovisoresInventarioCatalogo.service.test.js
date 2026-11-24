import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({ obtenerConexionParaConector: vi.fn() }));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerCapacidadesWfs: vi.fn(), obtenerCapacidadesWcs: vi.fn(), proxyWms: vi.fn(), proxyLeyenda: vi.fn(), consultarWfs: vi.fn(),
}));
vi.mock('../src/modules/fichas/fichas.service.js', () => ({
  adjuntarFichasAFeatures: vi.fn(), obtenerConfig: vi.fn(), listarFeaturesConCompletitud: vi.fn(),
}));
vi.mock('../src/modules/geovisores/capasNuevas.service.js', () => ({ obtenerCapasNuevas: vi.fn() }));
vi.mock('../src/modules/geovisores/lineaBaseCapas.js', () => ({ obtenerLineaBase: vi.fn() }));
vi.mock('../src/modules/geovisores/inventarioCatalogo.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  obtenerInventarioParaCatalogo: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { obtenerCapasNuevas } from '../src/modules/geovisores/capasNuevas.service.js';
import { obtenerLineaBase } from '../src/modules/geovisores/lineaBaseCapas.js';
import { obtenerInventarioParaCatalogo, MAX_PROFUNDIDAD_GRUPOS, EDAD_MAXIMA_INVENTARIO_MS } from '../src/modules/geovisores/inventarioCatalogo.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import { obtenerCatalogoCompletoDeGeovisor, obtenerCatalogoDeGeovisor } from '../src/modules/geovisores/geovisores.service.js';

const RIOS = 't_20_hidrologia:rios';
const CUENCAS = 't_20_hidrologia:cuencas';
const LAGOS = 't_20_hidrologia:lagos';
const SUELOS = 't_15_geologia:suelos';
const T32 = 't_32_areas_reglamentacion_especial:resguardos';
const BBOX = { oeste: -77, sur: 5, este: -76, norte: 6 };

const conexion = { id: 'conexion-uuid-1', url: 'https://gs.test/geoserver', capasNuevasAuto: false };

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-uuid-1', slug: 'agua', titulo: 'Agua', subtitulo: null, descripcion: null, cita: null, categoria: null,
    conexion_geoserver_id: 'conexion-uuid-1', workspaces_geoserver: ['t_20_hidrologia'], capas_seleccionadas: [],
    capas_con_ficha: [], incluir_capas_nuevas: false, color_por_tema: {}, centro_lat: 5.5, centro_lng: -76.6,
    zoom_inicial: 8, basemap_defecto: 'calles', area_max_ha: null, presets_area: [], visibilidad: 'publico',
    presentacion: { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] }, thumbnail_url: null,
    activo: true, orden: 0, creado_en: new Date().toISOString(), ...overrides,
  };
}

const grupo = (nombre, miembros, extra = {}) => ({
  grupo_id: `t_20_hidrologia:${nombre}`, espacio: 't_20_hidrologia', nombre, titulo: nombre.toUpperCase(), resumen: null, miembros, bbox: null, ...extra,
});
const capaDe = (id) => ({ tipo: 'capa', id });
const grupoDe = (nombre) => ({ tipo: 'grupo', id: `t_20_hidrologia:${nombre}` });

function inventario({ grupos = [], capas = {}, titulosEspacio = {}, terminadaEn = Date.now() } = {}) {
  return {
    terminadaEn,
    capas: new Map(Object.entries(capas).map(([id, c]) => [id, { capa_id: id, tipo: 'vectorial', bbox: null, palabras_clave: [], ...c }])),
    grupos,
    titulosEspacio: new Map(Object.entries(titulosEspacio)),
  };
}

const publicadas = [RIOS, CUENCAS, LAGOS, SUELOS, T32].map((id) => ({ id, nombre: id, tipo: 'vectorial', bbox: BBOX }));
const idsDeGrupos = (r) => r.grupos.map((g) => g.id);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue({ rows: [] });
  vi.mocked(obtenerConexionParaConector).mockResolvedValue(conexion);
  vi.mocked(geoserver.obtenerCapacidadesWfs).mockResolvedValue(publicadas);
  vi.mocked(geoserver.obtenerCapacidadesWcs).mockResolvedValue([]);
  vi.mocked(obtenerCapasNuevas).mockResolvedValue(new Set());
  vi.mocked(obtenerLineaBase).mockResolvedValue(new Set());
  vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(null);
});

// getBySlug y las restricciones de hermanos comparten `query`: la primera consulta es el geovisor.
const conGeovisor = (fila, hermanos = []) => {
  vi.mocked(query).mockReset().mockResolvedValueOnce({ rows: [fila] }).mockResolvedValue({ rows: hermanos });
};

describe('catálogo con inventario', () => {
  it('sin inventario (primera vez) mantiene la forma de siempre y grupos vacíos', async () => {
    conGeovisor(filaGeovisor());

    const r = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    expect(r.grupos).toEqual([]);
    expect(r).not.toHaveProperty('desactualizado');
    expect(r.temas).toEqual([{
      id: 'hidrologia',
      nombre: 'Hidrologia',
      capas: [RIOS, CUENCAS, LAGOS].map((id) => ({ id, nombre: id, tipo: 'vectorial', bbox: BBOX, nueva: false, tema: 'hidrologia' })),
    }]);
  });

  it('obtenerCatalogoDeGeovisor sigue devolviendo solo el arreglo de temas', async () => {
    conGeovisor(filaGeovisor());
    const temas = await obtenerCatalogoDeGeovisor('agua', null);
    expect(Array.isArray(temas)).toBe(true);
    expect(temas[0].id).toBe('hidrologia');
  });

  it('suma título, resumen, palabras clave y estilo a las capas, y usa el título de servicio del espacio como tema', async () => {
    conGeovisor(filaGeovisor());
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      capas: { [RIOS]: { titulo: 'Ríos de la región', resumen: 'Red hídrica', palabras_clave: ['agua'], estilo_defecto: 'line' } },
      titulosEspacio: { t_20_hidrologia: 'Hidrología y cuencas' },
    }));

    const { temas } = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    expect(temas[0].nombre).toBe('Hidrología y cuencas');
    expect(temas[0].capas.find((c) => c.id === RIOS)).toMatchObject({
      id: RIOS, nombre: RIOS, tema: 'hidrologia', titulo: 'Ríos de la región', resumen: 'Red hídrica', palabrasClave: ['agua'], estiloDefecto: 'line',
    });
    // Una capa que el inventario no conoce queda exactamente como antes.
    expect(Object.keys(temas[0].capas.find((c) => c.id === LAGOS))).toEqual(['id', 'nombre', 'tipo', 'bbox', 'nueva', 'tema']);
  });

  it('ofrece un grupo completo con sus capas en orden, tema y bbox de sus miembros', async () => {
    conGeovisor(filaGeovisor());
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [grupo('agua', [capaDe(CUENCAS), capaDe(RIOS)], { resumen: 'Todo el agua', titulo: 'Agua' })],
    }));

    const { grupos } = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    expect(grupos).toEqual([{
      id: 't_20_hidrologia:agua', nombre: 'agua', titulo: 'Agua', resumen: 'Todo el agua', tema: 'hidrologia', capas: [CUENCAS, RIOS], bbox: BBOX,
    }]);
  });

  it('un grupo con una capa de t_32 no se ofrece, ni siquiera en un geovisor que abarca toda la conexión', async () => {
    conGeovisor(filaGeovisor({ workspaces_geoserver: [] }));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [grupo('mixto', [capaDe(RIOS), capaDe(T32)]), grupo('limpio', [capaDe(RIOS)])],
    }));

    const r = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    expect(idsDeGrupos(r)).toEqual(['t_20_hidrologia:limpio']);
    expect(JSON.stringify(r)).not.toContain('t_32_areas_reglamentacion_especial');
  });

  it('un grupo que vive en el espacio t_32 nunca se ofrece', async () => {
    conGeovisor(filaGeovisor({ workspaces_geoserver: [] }));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [{ ...grupo('x', [capaDe(RIOS)]), grupo_id: 't_32_areas_reglamentacion_especial:x', espacio: 't_32_areas_reglamentacion_especial' }],
    }));
    expect((await obtenerCatalogoCompletoDeGeovisor('agua', null)).grupos).toEqual([]);
  });

  it('un grupo con una capa que el geovisor no permite no se ofrece (todo o nada)', async () => {
    conGeovisor(filaGeovisor({ workspaces_geoserver: [], capas_seleccionadas: [RIOS, CUENCAS] }));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [grupo('curado', [capaDe(RIOS), capaDe(CUENCAS)]), grupo('con_extra', [capaDe(RIOS), capaDe(SUELOS)])],
    }));

    expect(idsDeGrupos(await obtenerCatalogoCompletoDeGeovisor('agua', null))).toEqual(['t_20_hidrologia:curado']);
  });

  it('la reserva de un geovisor hermano más restrictivo oculta los grupos que usan esa capa', async () => {
    conGeovisor(filaGeovisor(), [{ workspaces_geoserver: [], capas_seleccionadas: [CUENCAS], visibilidad: 'acreditados' }]);
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [grupo('con_cuencas', [capaDe(RIOS), capaDe(CUENCAS)]), grupo('solo_rios', [capaDe(RIOS)])],
    }));

    expect(idsDeGrupos(await obtenerCatalogoCompletoDeGeovisor('agua', null))).toEqual(['t_20_hidrologia:solo_rios']);
  });

  it('las capas nuevas automáticas cuentan: un grupo con una capa nueva sale, uno con una antigua oculta no', async () => {
    vi.mocked(obtenerConexionParaConector).mockResolvedValue({ ...conexion, capasNuevasAuto: true });
    vi.mocked(obtenerLineaBase).mockResolvedValue(new Set([RIOS, CUENCAS]));
    conGeovisor(filaGeovisor({ workspaces_geoserver: [], capas_seleccionadas: [RIOS] }));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [grupo('con_nueva', [capaDe(RIOS), capaDe(LAGOS)]), grupo('con_antigua', [capaDe(RIOS), capaDe(CUENCAS)])],
    }));

    expect(idsDeGrupos(await obtenerCatalogoCompletoDeGeovisor('agua', null))).toEqual(['t_20_hidrologia:con_nueva']);
  });

  it('resuelve grupos anidados, aplanados y sin repetir capas', async () => {
    conGeovisor(filaGeovisor());
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [
        grupo('todo', [capaDe(RIOS), grupoDe('interno')], { titulo: 'A todo' }),
        grupo('interno', [capaDe(RIOS), capaDe(CUENCAS)], { titulo: 'B interno' }),
      ],
    }));

    const { grupos } = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    expect(grupos.map((g) => [g.id, g.capas])).toEqual([
      ['t_20_hidrologia:todo', [RIOS, CUENCAS]],
      ['t_20_hidrologia:interno', [RIOS, CUENCAS]],
    ]);
  });

  it('un grupo anidado que incluye una capa no permitida oculta al grupo que lo contiene', async () => {
    conGeovisor(filaGeovisor({ workspaces_geoserver: [] }));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [grupo('padre', [capaDe(RIOS), grupoDe('hijo')]), grupo('hijo', [capaDe(T32)])],
    }));
    expect((await obtenerCatalogoCompletoDeGeovisor('agua', null)).grupos).toEqual([]);
  });

  it('ciclos, profundidad excesiva, miembros desconocidos y grupos vacíos no se ofrecen', async () => {
    conGeovisor(filaGeovisor());
    const cadena = Array.from({ length: MAX_PROFUNDIDAD_GRUPOS + 2 }, (_, i) => grupo(`n${i}`, i === MAX_PROFUNDIDAD_GRUPOS + 1 ? [capaDe(RIOS)] : [grupoDe(`n${i + 1}`)]));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventario({
      grupos: [
        grupo('a', [grupoDe('b')]), grupo('b', [grupoDe('a')]),
        grupo('huerfano', [grupoDe('no_existe')]),
        grupo('vacio', []),
        ...cadena,
        grupo('ok', [capaDe(RIOS)]),
      ],
    }));

    const r = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    // n0 está demasiado hondo; los últimos eslabones de la cadena sí caben dentro del tope.
    expect(idsDeGrupos(r)).not.toContain('t_20_hidrologia:a');
    expect(idsDeGrupos(r)).not.toContain('t_20_hidrologia:b');
    expect(idsDeGrupos(r)).not.toContain('t_20_hidrologia:huerfano');
    expect(idsDeGrupos(r)).not.toContain('t_20_hidrologia:vacio');
    expect(idsDeGrupos(r)).not.toContain('t_20_hidrologia:n0');
    expect(idsDeGrupos(r)).toContain('t_20_hidrologia:ok');
  });
});

describe('resiliencia: GeoServer no responde', () => {
  const caido = () => {
    const error = Object.assign(new Error('GeoServer no respondió'), { status: 503, code: 'GEOSERVER_NO_DISPONIBLE' });
    vi.mocked(geoserver.obtenerCapacidadesWfs).mockRejectedValue(error);
    return error;
  };
  const inventarioReciente = (extra = {}) => inventario({
    capas: { [RIOS]: { titulo: 'Ríos' }, [T32]: { titulo: 'Resguardos' }, [SUELOS]: { titulo: 'Suelos' } },
    grupos: [grupo('agua', [capaDe(RIOS)])],
    ...extra,
  });

  it('sirve el inventario guardado marcando desactualizado y respetando las mismas reglas de acceso', async () => {
    caido();
    conGeovisor(filaGeovisor({ workspaces_geoserver: [] }));
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventarioReciente());

    const r = await obtenerCatalogoCompletoDeGeovisor('agua', null);

    expect(r.desactualizado).toBe(true);
    expect(r.temas.flatMap((t) => t.capas.map((c) => c.id)).sort()).toEqual([RIOS, SUELOS].sort());
    expect(idsDeGrupos(r)).toEqual(['t_20_hidrologia:agua']);
    expect(obtenerCapasNuevas).not.toHaveBeenCalled();
  });

  it('sin inventario devuelve el error de siempre', async () => {
    const error = caido();
    conGeovisor(filaGeovisor());
    await expect(obtenerCatalogoCompletoDeGeovisor('agua', null)).rejects.toBe(error);
  });

  it('con un inventario demasiado viejo devuelve el error de siempre', async () => {
    const error = caido();
    conGeovisor(filaGeovisor());
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventarioReciente({ terminadaEn: Date.now() - EDAD_MAXIMA_INVENTARIO_MS - 1000 }));
    await expect(obtenerCatalogoCompletoDeGeovisor('agua', null)).rejects.toBe(error);
  });

  it('otros errores (no de disponibilidad) no se disfrazan con el inventario', async () => {
    const error = Object.assign(new Error('x'), { status: 500 });
    vi.mocked(geoserver.obtenerCapacidadesWfs).mockRejectedValue(error);
    conGeovisor(filaGeovisor());
    vi.mocked(obtenerInventarioParaCatalogo).mockResolvedValue(inventarioReciente());
    await expect(obtenerCatalogoCompletoDeGeovisor('agua', null)).rejects.toBe(error);
  });
});
