import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  obtenerCapacidadesWfs, proxyWms, consultarWfs,
  obtenerAtributosCapa, contarFeaturesCapa, listarFeaturesCapa,
} from '../src/modules/geovisores/geoserver.connector.js';

const conexion = {
  id: 'conexion-test-1',
  url: 'https://geoserver.test.local/geoserver',
  usuarioLectura: 'lector',
  passwordDescifrada: 'lector-pass',
  timeoutMs: 5000,
};

const poligono = {
  type: 'Polygon',
  coordinates: [[[-76.9, 5.6], [-76.8, 5.6], [-76.8, 5.7], [-76.9, 5.7], [-76.9, 5.6]]],
};

/** Mockea fetch discriminando por el parámetro "request" de la URL. */
function stubFetchPorOperacion(handlers) {
  const mock = vi.fn(async (entrada) => {
    const url = typeof entrada === 'string' ? new URL(entrada) : entrada;
    const operacion = url.searchParams.get('request') ?? '';
    const manejador = handlers[operacion];
    if (!manejador) throw new Error(`Sin handler mockeado para request=${operacion}`);
    const cuerpo = await manejador();
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(String(cuerpo)),
      json: () => Promise.resolve(cuerpo),
      headers: { get: () => 'application/json' },
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('REGRESIÓN SSRF: solicitarConTimeout() fija la resolución DNS (pinning de IP)', () => {
  it('pasa un dispatcher con connect.lookup -- la validación y la conexión real usan la misma resolución, no dos independientes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, type: 'basic',
      text: () => Promise.resolve('<ok/>'), json: () => Promise.resolve({}),
      headers: { get: () => 'application/json' },
    });
    vi.stubGlobal('fetch', fetchMock);

    await proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:Capa' }), poligono);

    const opciones = fetchMock.mock.calls[0][1];
    expect(opciones.dispatcher).toBeDefined();
    expect(opciones.dispatcher.constructor.name).toBe('Agent');
  });
});

describe('REGRESIÓN SSRF: solicitarConTimeout() no sigue redirecciones', () => {
  it('rechaza con 502 GEOSERVER_REDIRECT_RECHAZADO si GeoServer responde un 302 (p.ej. hacia una IP interna)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 302, type: 'basic',
      headers: { get: () => null },
    }));

    await expect(
      proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:Capa' }), poligono),
    ).rejects.toMatchObject({ status: 502, code: 'GEOSERVER_REDIRECT_RECHAZADO' });
  });

  it('rechaza con el mismo código cuando fetch() resuelve una redirección "opaca" (redirect:"manual" en runtimes que no exponen status/headers)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ type: 'opaqueredirect', status: 0 }));

    await expect(
      proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:Capa' }), poligono),
    ).rejects.toMatchObject({ status: 502, code: 'GEOSERVER_REDIRECT_RECHAZADO' });
  });

  it('pasa `redirect: "manual"` en cada fetch() — nunca delega el seguimiento de 3xx al cliente HTTP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, type: 'basic',
      text: () => Promise.resolve('<ok/>'), json: () => Promise.resolve({}),
      headers: { get: () => 'application/json' },
    });
    vi.stubGlobal('fetch', fetchMock);

    await proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:Capa' }), poligono);

    expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'manual' }));
  });
});

function capabilitiesConFeatureType(bboxXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1">
      <wfs:FeatureTypeList>
        <wfs:FeatureType>
          <wfs:Name>t_19_clima:PrecipitacionAnual_IDEAM_2017_100K</wfs:Name>
          <wfs:Title>Precipitación anual</wfs:Title>
          ${bboxXml}
        </wfs:FeatureType>
      </wfs:FeatureTypeList>
    </wfs:WFS_Capabilities>`;
}

describe('obtenerCapacidadesWfs', () => {
  it('extrae el bbox geográfico real (WGS84BoundingBox) de cada capa', async () => {
    stubFetchPorOperacion({
      GetCapabilities: () => capabilitiesConFeatureType(`
        <ows:WGS84BoundingBox dimensions="2">
          <ows:LowerCorner>-77.5 4.2</ows:LowerCorner>
          <ows:UpperCorner>-76.0 6.1</ows:UpperCorner>
        </ows:WGS84BoundingBox>`),
    });

    const [capa] = await obtenerCapacidadesWfs(conexion);

    expect(capa.bbox).toEqual({ oeste: -77.5, sur: 4.2, este: -76.0, norte: 6.1 });
    expect(capa.tipo).toBe('vectorial');
  });

  it('no revienta y omite el bbox cuando GeoServer no lo publica para esa capa', async () => {
    stubFetchPorOperacion({ GetCapabilities: () => capabilitiesConFeatureType('') });

    const [capa] = await obtenerCapacidadesWfs(conexion);

    expect(capa.bbox).toBeUndefined();
    expect(capa.id).toBe('t_19_clima:PrecipitacionAnual_IDEAM_2017_100K');
  });

  it('usa la URL y credenciales de LA CONEXIÓN recibida, no una fija global', async () => {
    const fetchMock = stubFetchPorOperacion({ GetCapabilities: () => capabilitiesConFeatureType('') });
    const otraConexion = { ...conexion, url: 'https://otro-geoserver.test.local/geoserver' };

    await obtenerCapacidadesWfs(otraConexion);

    const urlLlamada = new URL(fetchMock.mock.calls[0][0]);
    expect(urlLlamada.origin + urlLlamada.pathname).toContain('otro-geoserver.test.local');
  });

  it('manda Authorization Basic cuando la conexión tiene credenciales', async () => {
    const fetchMock = stubFetchPorOperacion({ GetCapabilities: () => capabilitiesConFeatureType('') });

    await obtenerCapacidadesWfs(conexion);

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      `Basic ${Buffer.from('lector:lector-pass').toString('base64')}`,
    );
  });

  it('conexión externa sin credenciales (usuarioLectura/passwordDescifrada null): no manda Authorization', async () => {
    const fetchMock = stubFetchPorOperacion({ GetCapabilities: () => capabilitiesConFeatureType('') });
    const conexionExterna = { ...conexion, usuarioLectura: null, passwordDescifrada: null };

    await obtenerCapacidadesWfs(conexionExterna);

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe('proxyWms', () => {
  it('recorta con CQL_FILTER cuando se pasa geometriaFiltro y una sola capa', async () => {
    const fetchMock = stubFetchPorOperacion({
      DescribeFeatureType: () => `<?xml version="1.0"?><xsd:schema>
        <xsd:element name="the_geom" type="gml:MultiSurfacePropertyType"/>
      </xsd:schema>`,
      GetMap: () => 'binario',
    });

    await proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:CapaWmsRecortada' }), poligono);

    const url = new URL(fetchMock.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('CQL_FILTER')).toMatch(/^INTERSECTS\(the_geom, SRID=4326;POLYGON/);
  });

  it('con varias capas (separadas por coma) no intenta recortar', async () => {
    const fetchMock = stubFetchPorOperacion({ GetMap: () => 'binario' });

    await proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:CapaA,t_19_clima:CapaB' }), poligono);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.has('CQL_FILTER')).toBe(false);
  });

  it('descarta parámetros fuera de la lista blanca (nunca reenvía la query del cliente sin filtrar)', async () => {
    const fetchMock = stubFetchPorOperacion({ GetMap: () => 'binario' });

    await proxyWms(conexion, new URLSearchParams({ layers: 't_19_clima:X', request: 'DeleteEverything', cql_filter: 'DROP TABLE x' }));

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('request')).toBe('GetMap'); // fijado por el conector, no por el cliente
    expect(url.searchParams.has('cql_filter')).toBe(false);
  });
});

describe('consultarWfs', () => {
  it('anota el WKT con SRID=4326 (bug real de CRS documentado en producto6)', async () => {
    const fetchMock = stubFetchPorOperacion({
      DescribeFeatureType: () => `<?xml version="1.0"?><xsd:schema>
        <xsd:element name="the_geom" type="gml:MultiSurfacePropertyType"/>
      </xsd:schema>`,
      GetFeature: () => ({ type: 'FeatureCollection', features: [] }),
    });

    await consultarWfs(conexion, 't_19_clima:Capa', poligono);

    const url = new URL(fetchMock.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('CQL_FILTER')).toContain('SRID=4326;POLYGON');
    expect(url.searchParams.get('srsName')).toBe('EPSG:4326');
  });
});

describe('obtenerAtributosCapa', () => {
  it('excluye las columnas de geometría (gml:*PropertyType)', async () => {
    stubFetchPorOperacion({
      DescribeFeatureType: () => `<?xml version="1.0"?><xsd:schema>
        <xsd:element name="codigo_estacion" type="xsd:string"/>
        <xsd:element name="nombre_estacion" type="xsd:string"/>
        <xsd:element name="the_geom" type="gml:PointPropertyType"/>
      </xsd:schema>`,
    });

    const atributos = await obtenerAtributosCapa(conexion, 't_19_clima:Estaciones');

    expect(atributos).toEqual([
      { nombre: 'codigo_estacion', tipo: 'xsd:string' },
      { nombre: 'nombre_estacion', tipo: 'xsd:string' },
    ]);
  });

  it('propaga GEOSERVER_NO_DISPONIBLE si GeoServer responde con error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));

    await expect(obtenerAtributosCapa(conexion, 't_19_clima:Estaciones'))
      .rejects.toMatchObject({ status: 502, code: 'GEOSERVER_NO_DISPONIBLE' });
  });
});

describe('contarFeaturesCapa', () => {
  it('pide resultType=hits y devuelve totalFeatures cuando la respuesta SÍ es JSON', async () => {
    const mock = vi.fn(async (entrada) => {
      const url = typeof entrada === 'string' ? new URL(entrada) : entrada;
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ type: 'FeatureCollection', totalFeatures: 42, features: [] })),
        json: () => Promise.resolve({ type: 'FeatureCollection', totalFeatures: 42, features: [] }),
        headers: { get: () => 'application/json' },
        _url: url,
      };
    });
    vi.stubGlobal('fetch', mock);

    const total = await contarFeaturesCapa(conexion, 't_19_clima:Estaciones');

    expect(total).toBe(42);
    const url = new URL(mock.mock.calls[0][0]);
    expect(url.searchParams.get('resultType')).toBe('hits');
  });

  it('devuelve 0 si la respuesta JSON no trae totalFeatures', async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ type: 'FeatureCollection', features: [] })),
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
      headers: { get: () => 'application/json' },
    }));
    vi.stubGlobal('fetch', mock);

    expect(await contarFeaturesCapa(conexion, 't_19_clima:Estaciones')).toBe(0);
  });

  // Regresión: geo.siatpc.co (GeoServer real en producción) ignora
  // outputFormat=application/json cuando resultType=hits y siempre responde
  // la forma WFS 2.0 en XML -- descubierto en la primera prueba end-to-end
  // contra datos reales (capa de 319 estaciones climáticas del IDEAM).
  it('parsea numberMatched del XML cuando GeoServer ignora outputFormat=json en resultType=hits', async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(
        '<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="319" numberReturned="0" timeStamp="2026-09-29T17:52:46.264Z"/>',
      ),
      json: () => Promise.reject(new Error('no debería llamarse .json() sobre una respuesta XML')),
      headers: { get: () => 'text/xml' },
    }));
    vi.stubGlobal('fetch', mock);

    const total = await contarFeaturesCapa(conexion, 't_19_clima:Estaciones_reales');

    expect(total).toBe(319);
  });

  it('devuelve 0 si la respuesta XML no trae numberMatched', async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<?xml version="1.0"?><algo/>'),
      json: () => Promise.reject(new Error('no debería llamarse')),
      headers: { get: () => 'text/xml' },
    }));
    vi.stubGlobal('fetch', mock);

    expect(await contarFeaturesCapa(conexion, 't_19_clima:Otra')).toBe(0);
  });
});

describe('listarFeaturesCapa', () => {
  it('restringe propertyName al identificador + etiqueta + geometría, con srsName EPSG:4326', async () => {
    const fetchMock = stubFetchPorOperacion({
      DescribeFeatureType: () => `<?xml version="1.0"?><xsd:schema>
        <xsd:element name="the_geom" type="gml:PointPropertyType"/>
      </xsd:schema>`,
      GetFeature: () => ({ type: 'FeatureCollection', features: [] }),
    });

    await listarFeaturesCapa(conexion, 't_19_clima:capa-a', 'codigo_estacion', 'nombre_estacion');

    const url = new URL(fetchMock.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('propertyName')).toBe('codigo_estacion,nombre_estacion,the_geom');
    expect(url.searchParams.get('srsName')).toBe('EPSG:4326');
  });

  it('sin campoEtiqueta, propertyName trae identificador + geometría', async () => {
    const fetchMock = stubFetchPorOperacion({
      DescribeFeatureType: () => `<?xml version="1.0"?><xsd:schema>
        <xsd:element name="the_geom" type="gml:PointPropertyType"/>
      </xsd:schema>`,
      GetFeature: () => ({ type: 'FeatureCollection', features: [] }),
    });

    await listarFeaturesCapa(conexion, 't_19_clima:capa-b', 'codigo_estacion', undefined);

    const url = new URL(fetchMock.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('propertyName')).toBe('codigo_estacion,the_geom');
  });

  // Regresión: sin incluir la columna de geometría en propertyName, GeoServer
  // devuelve cada feature con geometry:null (propertyName es una lista
  // exacta) -- verificado contra geo.siatpc.co en producción, donde esto
  // dejaba sin centroide a las 319 estaciones climáticas reales.
  it('usa el nombre real de la columna de geometría resuelto por DescribeFeatureType, no "the_geom" a ciegas', async () => {
    const fetchMock = stubFetchPorOperacion({
      DescribeFeatureType: () => `<?xml version="1.0"?><xsd:schema>
        <xsd:element name="geom_punto" type="gml:PointPropertyType"/>
      </xsd:schema>`,
      GetFeature: () => ({ type: 'FeatureCollection', features: [] }),
    });

    await listarFeaturesCapa(conexion, 't_19_clima:capa-c', 'codigo', 'nombre');

    const url = new URL(fetchMock.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('propertyName')).toBe('codigo,nombre,geom_punto');
  });
});
