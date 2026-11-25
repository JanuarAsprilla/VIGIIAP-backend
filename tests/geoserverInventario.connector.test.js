import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  obtenerCapacidadesWms, listarEspaciosRest, listarGruposRest, listarEstilosRest, MAX_BYTES_INVENTARIO,
} from '../src/modules/geovisores/geoserver.connector.js';

const conexion = {
  id: 'c1', url: 'https://geoserver.test.local/geoserver/wms', usuarioLectura: 'lector', passwordDescifrada: 'secreto', timeoutMs: 5000,
};

const WMS_MINIMO = `<WMS_Capabilities><Capability><Layer><Layer><Name>ws:a</Name><Title>A</Title></Layer></Layer></Capability></WMS_Capabilities>`;

/** Rutas → [estado, cuerpo]; cualquier ruta no declarada responde 404. */
function stubFetch(rutas) {
  const mock = vi.fn(async (entrada, opciones) => {
    const url = new URL(String(entrada));
    const clave = url.pathname + (url.searchParams.get('request') ? `?request=${url.searchParams.get('request')}` : '');
    const [estado, cuerpo, cabeceras] = rutas[clave] ?? [404, ''];
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return {
      ok: estado >= 200 && estado < 300,
      status: estado,
      text: () => Promise.resolve(texto),
      headers: { get: (nombre) => cabeceras?.[nombre.toLowerCase()] ?? null },
      _auth: opciones?.headers?.Authorization,
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('obtenerCapacidadesWms()', () => {
  it('pide WMS 1.3.0 a la base del servidor sin duplicar «/wms»', async () => {
    const fetchMock = stubFetch({ '/geoserver/wms?request=GetCapabilities': [200, WMS_MINIMO] });

    const { capas } = await obtenerCapacidadesWms(conexion);

    expect(capas.map((c) => c.id)).toEqual(['ws:a']);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/geoserver/wms');
    expect(url.searchParams.get('version')).toBe('1.3.0');
  });

  it('un error HTTP se informa como GEOSERVER_NO_DISPONIBLE', async () => {
    stubFetch({ '/geoserver/wms?request=GetCapabilities': [500, 'x'] });
    await expect(obtenerCapacidadesWms(conexion)).rejects.toMatchObject({ code: 'GEOSERVER_NO_DISPONIBLE' });
  });

  it('corta una respuesta declarada por encima del tope de bytes', async () => {
    stubFetch({ '/geoserver/wms?request=GetCapabilities': [200, WMS_MINIMO, { 'content-length': String(MAX_BYTES_INVENTARIO + 1) }] });
    await expect(obtenerCapacidadesWms(conexion)).rejects.toMatchObject({ code: 'INVENTARIO_DEMASIADO_GRANDE' });
  });

  it('respeta el plazo de la sincronización', async () => {
    stubFetch({});
    await expect(obtenerCapacidadesWms(conexion, { venceEn: Date.now() - 1 })).rejects.toMatchObject({ code: 'INVENTARIO_TIEMPO_AGOTADO' });
  });
});

describe('API REST', () => {
  const REST = '/geoserver/rest';

  it('listarEspaciosRest une espacio de nombres y título de servicio, y tolera 404 en los ajustes', async () => {
    stubFetch({
      [`${REST}/workspaces.json`]: [200, { workspaces: { workspace: [{ name: 't_20_hidrologia' }, { name: 'sin_ajustes' }] } }],
      [`${REST}/namespaces/t_20_hidrologia.json`]: [200, { namespace: { uri: 'http://iiap/hidro', isolated: false } }],
      [`${REST}/namespaces/sin_ajustes.json`]: [200, { namespace: { uri: 'http://iiap/otro', isolated: true } }],
      [`${REST}/services/wms/workspaces/t_20_hidrologia/settings.json`]: [200, { wms: { title: 'Hidrología', abstrct: 'Agua' } }],
    });

    const espacios = await listarEspaciosRest(conexion);

    expect(espacios).toEqual([
      { nombre: 't_20_hidrologia', namespaceUri: 'http://iiap/hidro', aislado: false, tituloServicio: 'Hidrología', resumenServicio: 'Agua' },
      { nombre: 'sin_ajustes', namespaceUri: 'http://iiap/otro', aislado: true, tituloServicio: null, resumenServicio: null },
    ]);
  });

  it('con 401 (incluso tras el reintento anónimo) falla con GEOSERVER_REST_NO_DISPONIBLE y reintenta sin credenciales', async () => {
    const fetchMock = stubFetch({ [`${REST}/workspaces.json`]: [401, ''] });

    await expect(listarEspaciosRest(conexion)).rejects.toMatchObject({ code: 'GEOSERVER_REST_NO_DISPONIBLE', status: 401 });

    const autorizaciones = await Promise.all(fetchMock.mock.results.map((r) => r.value.then((v) => v._auth)));
    expect(autorizaciones[0]).toMatch(/^Basic /);
    expect(autorizaciones[1]).toBeUndefined();
  });

  it('un JSON inválido se informa sin evaluar nada', async () => {
    stubFetch({ [`${REST}/workspaces.json`]: [200, '{no es json'] });
    await expect(listarEspaciosRest(conexion)).rejects.toMatchObject({ code: 'RESPUESTA_REST_INVALIDA' });
  });

  it('listarGruposRest trae grupos globales y por espacio con su detalle', async () => {
    stubFetch({
      [`${REST}/layergroups.json`]: [200, { layerGroups: { layerGroup: [{ name: 'base', href: 'http://interna/x' }] } }],
      [`${REST}/layergroups/base.json`]: [200, { layerGroup: { name: 'base', publishables: { published: { '@type': 'layer', name: 'ws:a' } } } }],
      [`${REST}/workspaces/ws/layergroups.json`]: [200, { layerGroups: '' }],
      [`${REST}/workspaces/otro/layergroups.json`]: [200, { layerGroups: { layerGroup: [{ name: 'g' }] } }],
      [`${REST}/workspaces/otro/layergroups/g.json`]: [200, { layerGroup: { name: 'g', title: 'G', workspace: { name: 'otro' }, publishables: { published: [{ '@type': 'layer', name: 'otro:b' }] } } }],
    });

    const grupos = await listarGruposRest(conexion, { espacios: ['ws', 'otro'] });

    expect(grupos.map((g) => g.id)).toEqual(['base', 'otro:g']);
    expect(grupos[1]).toMatchObject({ titulo: 'G', miembros: [{ tipo: 'capa', id: 'otro:b' }] });
    expect(JSON.stringify(grupos)).not.toContain('interna');
  });

  it('listarEstilosRest junta los estilos globales y los de cada espacio', async () => {
    stubFetch({
      [`${REST}/styles.json`]: [200, { styles: { style: [{ name: 'line' }, { name: 'polygon' }] } }],
      [`${REST}/workspaces/ws/styles.json`]: [200, { styles: { style: { name: 'propio' } } }],
    });

    expect(await listarEstilosRest(conexion, { espacios: ['ws'] })).toEqual([
      { nombre: 'line', espacio: null }, { nombre: 'polygon', espacio: null }, { nombre: 'propio', espacio: 'ws' },
    ]);
  });
});
