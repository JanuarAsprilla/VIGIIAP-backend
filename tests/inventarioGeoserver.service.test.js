import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/bloqueoTareas.js', () => ({ conBloqueo: vi.fn() }));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({ obtenerConexionParaConector: vi.fn() }));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerCapacidadesWms: vi.fn(),
  obtenerCapacidadesWfs: vi.fn(),
  obtenerCapacidadesWcs: vi.fn(),
  listarEspaciosRest: vi.fn(),
  listarGruposRest: vi.fn(),
  listarEstilosRest: vi.fn(),
}));
vi.mock('../src/modules/geovisores/inventarioGeoserver.store.js', () => ({
  enTransaccion: vi.fn(),
  leerFilas: vi.fn(),
  aplicarDiferencias: vi.fn(),
  registrarSincronizacion: vi.fn(),
  ultimaSincronizacion: vi.fn(),
  leerInventario: vi.fn(),
}));

import { conBloqueo } from '../src/utils/bloqueoTareas.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import * as store from '../src/modules/geovisores/inventarioGeoserver.store.js';
import { sincronizarConexion, obtenerInventarioAdmin } from '../src/modules/geovisores/inventarioGeoserver.service.js';
import { TIPOS_INVENTARIO } from '../src/modules/geovisores/inventarioDiferencias.js';

const RIOS = 't_20_hidrologia:rios';
const CUENCAS = 't_20_hidrologia:cuencas';
const T32 = 't_32_areas_reglamentacion_especial:resguardos';
const CONEXION = { id: 'c1', tipo: 'propio', url: 'https://gs.test/geoserver/wms', usuarioLectura: 'u', passwordDescifrada: 'secreto', timeoutMs: 1000 };

const wmsBase = () => ({
  capas: [
    { id: RIOS, titulo: 'Ríos', resumen: 'Red', palabrasClave: ['agua'], bbox: { oeste: -77, sur: 5, este: -76, norte: 6 }, crs: ['EPSG:4326'], estilos: [{ nombre: 'line' }], estiloDefecto: 'line' },
    { id: CUENCAS, titulo: 'Cuencas', palabrasClave: [], crs: [], estilos: [] },
    { id: T32, titulo: 'Resguardos', palabrasClave: [], crs: [], estilos: [] },
  ],
  grupos: [{ id: 't_20_hidrologia:agua', titulo: 'Agua', miembros: [{ tipo: 'capa', id: RIOS }, { tipo: 'capa', id: CUENCAS }] }],
});
const restBase = () => ({
  espacios: [
    { nombre: 't_20_hidrologia', namespaceUri: 'http://iiap/hidro', aislado: false, tituloServicio: 'Hidrología', resumenServicio: null },
    { nombre: 't_32_areas_reglamentacion_especial', namespaceUri: null, aislado: false, tituloServicio: null, resumenServicio: null },
  ],
  grupos: [{ id: 't_20_hidrologia:agua', espacio: 't_20_hidrologia', nombre: 'agua', titulo: 'Agua', resumen: null, modo: 'SINGLE', miembros: [{ tipo: 'capa', id: RIOS }, { tipo: 'capa', id: CUENCAS }] }],
  estilos: [{ nombre: 'line', espacio: null }],
});

/** Almacén en memoria que imita lo que hace el real: aplicarDiferencias escribe, leerFilas lee. */
let tablas;
let sincronizaciones;
function montarAlmacenEnMemoria() {
  tablas = { espacios: [], capas: [], grupos: [], estilos: [] };
  sincronizaciones = [];
  vi.mocked(store.enTransaccion).mockImplementation((trabajo) => trabajo({}));
  vi.mocked(store.leerFilas).mockImplementation(async (_e, tipo) => structuredClone(tablas[tipo]));
  vi.mocked(store.aplicarDiferencias).mockImplementation(async (_c, tipo, _id, dif, instante) => {
    const { clave } = TIPOS_INVENTARIO[tipo];
    const filas = new Map(tablas[tipo].map((f) => [f[clave], f]));
    [...dif.nuevos, ...dif.cambiados].forEach((f) => filas.set(f[clave], { ...f, eliminado_en: null, ultima_vez_visto: instante }));
    dif.eliminados.forEach((k) => filas.set(k, { ...filas.get(k), eliminado_en: instante }));
    tablas[tipo] = [...filas.values()];
  });
  vi.mocked(store.registrarSincronizacion).mockImplementation(async (datos) => { sincronizaciones.push(datos); });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(conBloqueo).mockImplementation(async (_n, tarea) => ({ ejecutada: true, resultado: await tarea() }));
  vi.mocked(obtenerConexionParaConector).mockResolvedValue(CONEXION);
  vi.mocked(geoserver.obtenerCapacidadesWms).mockResolvedValue(wmsBase());
  vi.mocked(geoserver.obtenerCapacidadesWfs).mockResolvedValue([{ id: RIOS, nombre: 'Ríos', tipo: 'vectorial' }, { id: T32, nombre: T32, tipo: 'vectorial' }]);
  vi.mocked(geoserver.obtenerCapacidadesWcs).mockResolvedValue([{ id: CUENCAS, nombre: 'Cuencas', tipo: 'raster' }]);
  vi.mocked(geoserver.listarEspaciosRest).mockResolvedValue(restBase().espacios);
  vi.mocked(geoserver.listarGruposRest).mockResolvedValue(restBase().grupos);
  vi.mocked(geoserver.listarEstilosRest).mockResolvedValue(restBase().estilos);
  montarAlmacenEnMemoria();
});

const SIN_CAMBIOS = { nuevos: 0, cambiados: 0, eliminados: 0 };

describe('sincronizarConexion()', () => {
  it('con REST: guarda espacios, capas, grupos y estilos, y registra la sincronización', async () => {
    const r = await sincronizarConexion('c1', { origen: 'manual' });

    expect(r).toMatchObject({ estado: 'ok', fuente: 'rest+ogc', error: null });
    expect(r.resumen).toEqual({
      espacios: { nuevos: 2, cambiados: 0, eliminados: 0 },
      capas: { nuevos: 3, cambiados: 0, eliminados: 0 },
      grupos: { nuevos: 1, cambiados: 0, eliminados: 0 },
      estilos: { nuevos: 1, cambiados: 0, eliminados: 0 },
    });
    expect(r.duracion_ms).toBeGreaterThanOrEqual(0);
    expect(tablas.capas.find((c) => c.capa_id === CUENCAS)).toMatchObject({ tipo: 'raster', espacio: 't_20_hidrologia', nombre: 'cuencas' });
    expect(tablas.espacios.find((e) => e.nombre === 't_20_hidrologia')).toMatchObject({ titulo_servicio: 'Hidrología', namespace_uri: 'http://iiap/hidro' });
    expect(tablas.grupos[0].miembros).toEqual([{ tipo: 'capa', id: RIOS }, { tipo: 'capa', id: CUENCAS }]);
    expect(sincronizaciones).toEqual([expect.objectContaining({ conexionId: 'c1', estado: 'ok', fuente: 'rest+ogc', origen: 'manual' })]);
  });

  it('es idempotente: repetirla sin cambios en GeoServer no registra nuevos, cambiados ni eliminados', async () => {
    await sincronizarConexion('c1');
    const segunda = await sincronizarConexion('c1');

    expect(segunda.resumen).toEqual({ espacios: SIN_CAMBIOS, capas: SIN_CAMBIOS, grupos: SIN_CAMBIOS, estilos: SIN_CAMBIOS });
    expect(tablas.capas).toHaveLength(3);
  });

  it('detecta una capa nueva, un título cambiado y un grupo eliminado, y no borra la fila eliminada', async () => {
    await sincronizarConexion('c1');
    const wms = wmsBase();
    wms.capas[0] = { ...wms.capas[0], titulo: 'Ríos de la región' };
    wms.capas.push({ id: 't_20_hidrologia:lagos', titulo: 'Lagos', palabrasClave: [], crs: [], estilos: [] });
    wms.grupos = [];
    vi.mocked(geoserver.obtenerCapacidadesWms).mockResolvedValue(wms);
    vi.mocked(geoserver.listarGruposRest).mockResolvedValue([]);

    const r = await sincronizarConexion('c1');

    expect(r.resumen.capas).toEqual({ nuevos: 1, cambiados: 1, eliminados: 0 });
    expect(r.resumen.grupos).toEqual({ nuevos: 0, cambiados: 0, eliminados: 1 });
    expect(tablas.grupos).toHaveLength(1);
    expect(tablas.grupos[0].eliminado_en).toBeInstanceOf(Date);
  });

  it('una capa que desaparece se marca eliminada y, si vuelve, cuenta como nueva', async () => {
    await sincronizarConexion('c1');
    const sinCuencas = { ...wmsBase(), capas: wmsBase().capas.filter((c) => c.id !== CUENCAS) };
    vi.mocked(geoserver.obtenerCapacidadesWms).mockResolvedValue(sinCuencas);
    vi.mocked(geoserver.obtenerCapacidadesWcs).mockResolvedValue([]);
    expect((await sincronizarConexion('c1')).resumen.capas.eliminados).toBe(1);

    vi.mocked(geoserver.obtenerCapacidadesWms).mockResolvedValue(wmsBase());
    vi.mocked(geoserver.obtenerCapacidadesWcs).mockResolvedValue([{ id: CUENCAS, nombre: 'Cuencas', tipo: 'raster' }]);
    expect((await sincronizarConexion('c1')).resumen.capas.nuevos).toBe(1);
  });

  it('si la REST responde 401 degrada a solo OGC: parcial, sin error fatal, y conserva lo que sabía de los espacios', async () => {
    await sincronizarConexion('c1');
    vi.mocked(geoserver.listarEspaciosRest).mockRejectedValue(Object.assign(new Error('x'), { code: 'GEOSERVER_REST_NO_DISPONIBLE', status: 401 }));

    const r = await sincronizarConexion('c1');

    expect(r).toMatchObject({ estado: 'parcial', fuente: 'ogc' });
    expect(r.error).toMatch(/REST respondió 401/);
    expect(r.resumen.espacios).toEqual(SIN_CAMBIOS);
    expect(r.resumen.estilos).toEqual(SIN_CAMBIOS);
    expect(tablas.espacios.find((e) => e.nombre === 't_20_hidrologia').titulo_servicio).toBe('Hidrología');
    expect(sincronizaciones.at(-1)).toMatchObject({ estado: 'parcial', fuente: 'ogc' });
  });

  it('sin REST desde el principio deduce los espacios del prefijo de las capas, sin título de servicio', async () => {
    vi.mocked(geoserver.listarEspaciosRest).mockRejectedValue(Object.assign(new Error('x'), { code: 'GEOSERVER_REST_NO_DISPONIBLE', status: 404 }));

    const r = await sincronizarConexion('c1');

    expect(r.fuente).toBe('ogc');
    expect(tablas.espacios.map((e) => e.nombre).sort()).toEqual(['t_20_hidrologia', 't_32_areas_reglamentacion_especial']);
    expect(tablas.espacios.every((e) => e.titulo_servicio === null)).toBe(true);
    expect(tablas.estilos.map((e) => e.estilo_id)).toEqual(['line']);
  });

  it('una conexión externa no consulta la REST y no se marca parcial', async () => {
    vi.mocked(obtenerConexionParaConector).mockResolvedValue({ ...CONEXION, tipo: 'externo' });

    const r = await sincronizarConexion('c1');

    expect(geoserver.listarEspaciosRest).not.toHaveBeenCalled();
    expect(r).toMatchObject({ estado: 'ok', fuente: 'ogc' });
  });

  it('si WFS o WCS fallan queda parcial y las capas conservan su tipo anterior', async () => {
    await sincronizarConexion('c1');
    vi.mocked(geoserver.obtenerCapacidadesWcs).mockRejectedValue(new Error('caído'));

    const r = await sincronizarConexion('c1');

    expect(r.estado).toBe('parcial');
    expect(r.resumen.capas).toEqual(SIN_CAMBIOS);
    expect(tablas.capas.find((c) => c.capa_id === CUENCAS).tipo).toBe('raster');
  });

  it('una sincronización fallida (GeoServer caído) no borra el inventario previo ni lanza', async () => {
    await sincronizarConexion('c1');
    const antes = structuredClone(tablas);
    vi.mocked(store.aplicarDiferencias).mockClear();
    vi.mocked(geoserver.obtenerCapacidadesWms).mockRejectedValue(Object.assign(new Error('GeoServer no respondió a tiempo'), { code: 'GEOSERVER_NO_DISPONIBLE' }));

    const r = await sincronizarConexion('c1');

    expect(r).toMatchObject({ estado: 'error', fuente: 'ogc', resumen: {}, error: 'GeoServer no respondió a tiempo' });
    expect(store.aplicarDiferencias).not.toHaveBeenCalled();
    expect(tablas).toEqual(antes);
    expect(sincronizaciones.at(-1)).toMatchObject({ estado: 'error' });
  });

  it('un fallo de base de datos se registra como error sin exponer el detalle interno', async () => {
    vi.mocked(store.aplicarDiferencias).mockRejectedValue(new Error('relation "geoserver_inventario_capas" does not exist'));

    const r = await sincronizarConexion('c1');

    expect(r.estado).toBe('error');
    expect(r.error).toBe('Error interno al guardar el inventario');
    expect(JSON.stringify(sincronizaciones)).not.toContain('relation');
  });

  it('un XML enorme o inválido también queda como error legible', async () => {
    vi.mocked(geoserver.obtenerCapacidadesWms).mockRejectedValue(Object.assign(new Error('XML inválido: etiquetas sin cerrar'), { code: 'XML_INVALIDO' }));
    expect((await sincronizarConexion('c1')).error).toBe('XML inválido: etiquetas sin cerrar');
  });

  it('si otra instancia (o el planificador) ya la sincroniza lanza 409 y no toca GeoServer', async () => {
    vi.mocked(conBloqueo).mockResolvedValue({ ejecutada: false });

    await expect(sincronizarConexion('c1')).rejects.toMatchObject({ status: 409, code: 'SINCRONIZACION_EN_CURSO' });

    expect(geoserver.obtenerCapacidadesWms).not.toHaveBeenCalled();
    expect(conBloqueo).toHaveBeenCalledWith('geoserver_inventario:c1', expect.any(Function));
  });

  it('una conexión inexistente o desactivada propaga el error sin registrar nada', async () => {
    vi.mocked(obtenerConexionParaConector).mockRejectedValue(Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 }));
    await expect(sincronizarConexion('c1')).rejects.toMatchObject({ status: 404 });
    expect(sincronizaciones).toHaveLength(0);
  });
});

describe('obtenerInventarioAdmin()', () => {
  const FILAS = {
    espacios: [{ conexion_id: 'c1', nombre: 't_20_hidrologia', namespace_uri: 'http://iiap/hidro', titulo_servicio: 'Hidrología', resumen_servicio: null, aislado: false, primera_vez_visto: 'a', ultima_vez_visto: 'b', eliminado_en: null }],
    capas: [{ conexion_id: 'c1', capa_id: RIOS, espacio: 't_20_hidrologia', nombre: 'rios', titulo: 'Ríos' }, { conexion_id: 'c1', capa_id: CUENCAS, espacio: 't_20_hidrologia', nombre: 'cuencas', titulo: 'Cuencas' }],
    grupos: [{ conexion_id: 'c1', grupo_id: 't_20_hidrologia:agua', espacio: 't_20_hidrologia', nombre: 'agua', miembros: [] }],
    estilos: [{ conexion_id: 'c1', estilo_id: 'line', nombre: 'line', espacio: null }],
  };

  it('arma la vista con conteos por espacio, sin conexion_id ni credenciales', async () => {
    vi.mocked(store.ultimaSincronizacion).mockResolvedValue({ iniciada_en: 'i', terminada_en: 't', estado: 'ok', fuente: 'rest+ogc', origen: 'manual', resumen: {}, error: null });
    vi.mocked(store.leerInventario).mockResolvedValue(FILAS);

    const vista = await obtenerInventarioAdmin('c1');

    expect(vista.sincronizacion).toEqual({ iniciada_en: 'i', terminada_en: 't', estado: 'ok', fuente: 'rest+ogc', resumen: {}, error: null });
    expect(vista.espacios[0]).toMatchObject({ nombre: 't_20_hidrologia', titulo: 'Hidrología', capas: 2, grupos: 1 });
    expect(store.leerInventario).toHaveBeenCalledWith('c1', { incluirEliminados: false });
    const texto = JSON.stringify(vista);
    expect(texto).not.toContain('conexion_id');
    expect(texto).not.toMatch(/secreto|password|passwordDescifrada|usuario_lectura/);
  });

  it('sin sincronizaciones previas devuelve sincronizacion null y listas vacías', async () => {
    vi.mocked(store.ultimaSincronizacion).mockResolvedValue(null);
    vi.mocked(store.leerInventario).mockResolvedValue({ espacios: [], capas: [], grupos: [], estilos: [] });

    expect(await obtenerInventarioAdmin('c1', { incluirEliminados: true })).toEqual({ sincronizacion: null, espacios: [], capas: [], grupos: [], estilos: [] });
    expect(store.leerInventario).toHaveBeenCalledWith('c1', { incluirEliminados: true });
  });
});
