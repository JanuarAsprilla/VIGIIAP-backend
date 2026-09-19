import { afterEach, describe, expect, it, vi } from 'vitest';
import { obtenerCapacidadesWfs, proxyWms, consultarWfs } from '../src/modules/geovisores/geoserver.connector.js';

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
