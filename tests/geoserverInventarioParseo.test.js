import { describe, it, expect } from 'vitest';
import {
  parsearXml, parsearCapacidadesWms, derivarBaseRest, derivarBaseOgc, listaRest, parsearGrupoRest, MAX_NODOS_XML,
} from '../src/modules/geovisores/geoserverInventarioParseo.js';

const WMS = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Capability>
    <Layer>
      <Title>GeoServer Web Map Service</Title>
      <CRS>EPSG:4326</CRS><CRS>EPSG:3857</CRS>
      <Layer queryable="1">
        <Name>t_20_hidrologia:rios</Name>
        <Title>Ríos &amp; quebradas</Title>
        <Abstract>Red hídrica principal</Abstract>
        <KeywordList><Keyword>agua</Keyword><Keyword>rios</Keyword></KeywordList>
        <CRS>EPSG:9377</CRS>
        <EX_GeographicBoundingBox>
          <westBoundLongitude>-77.5</westBoundLongitude><eastBoundLongitude>-76.1</eastBoundLongitude>
          <southBoundLatitude>4.9</southBoundLatitude><northBoundLatitude>6.2</northBoundLatitude>
        </EX_GeographicBoundingBox>
        <Style><Name>line</Name><Title>Línea</Title>
          <LegendURL width="20" height="20"><Format>image/png</Format><OnlineResource xlink:type="simple" xlink:href="https://x.test/legend?layer=rios"/></LegendURL>
        </Style>
        <Style><Name>t_20_hidrologia:azul</Name></Style>
      </Layer>
      <Layer>
        <Name>t_20_hidrologia:cuencas</Name><Title>Cuencas</Title>
      </Layer>
      <Layer>
        <Name>t_20_hidrologia:subgrupo</Name><Title>Subgrupo</Title>
        <Layer><Name>t_20_hidrologia:cuencas</Name><Title>Cuencas</Title></Layer>
      </Layer>
      <Layer>
        <Name>t_20_hidrologia:grupo_agua</Name><Title>Agua</Title><Abstract>Todo el agua</Abstract>
        <Layer><Name>t_20_hidrologia:rios</Name><Title>Ríos</Title></Layer>
        <Layer><Title>Carpeta sin nombre</Title>
          <Layer><Name>t_20_hidrologia:lagos</Name><Title>Lagos</Title></Layer>
        </Layer>
        <Layer><Name>t_20_hidrologia:subgrupo</Name><Title>Subgrupo</Title>
          <Layer><Name>t_20_hidrologia:cuencas</Name><Title>Cuencas</Title></Layer>
        </Layer>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

describe('parsearXml()', () => {
  it('rechaza DOCTYPE y entidades externas (XXE)', () => {
    expect(() => parsearXml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>')).toThrow(/DOCTYPE|inválido/i);
  });

  it('rechaza XML mal formado', () => {
    expect(() => parsearXml('<a><b></a>')).toThrow(/inválido/i);
    expect(() => parsearXml('<a><b>')).toThrow(/inválido/i);
  });

  it('decodifica entidades una sola vez y quita prefijos de espacio de nombres', () => {
    const raiz = parsearXml('<ows:A xmlns:ows="x"><ows:B xlink:href="h">1 &amp;lt; &#65;</ows:B></ows:A>');
    expect(raiz.nombre).toBe('A');
    expect(raiz.hijos[0].texto).toBe('1 &lt; A');
    expect(raiz.hijos[0].atributos.href).toBe('h');
  });

  it('acota el número de nodos', () => {
    const xml = `<a>${'<b/>'.repeat(MAX_NODOS_XML + 1)}</a>`;
    expect(() => parsearXml(xml)).toThrow(/demasiado/i);
  });
});

describe('parsearCapacidadesWms()', () => {
  const { capas, grupos } = parsearCapacidadesWms(WMS);
  const capa = (id) => capas.find((c) => c.id === id);
  const grupo = (id) => grupos.find((g) => g.id === id);

  it('extrae título, resumen, palabras clave, bbox, CRS heredados y estilos de una capa', () => {
    expect(capa('t_20_hidrologia:rios')).toMatchObject({
      titulo: 'Ríos & quebradas',
      resumen: 'Red hídrica principal',
      palabrasClave: ['agua', 'rios'],
      bbox: { oeste: -77.5, sur: 4.9, este: -76.1, norte: 6.2 },
      crs: ['EPSG:4326', 'EPSG:3857', 'EPSG:9377'],
      estiloDefecto: 'line',
    });
    expect(capa('t_20_hidrologia:rios').estilos).toEqual([
      { nombre: 'line', leyendaUrl: 'https://x.test/legend?layer=rios' },
      { nombre: 't_20_hidrologia:azul', leyendaUrl: undefined },
    ]);
  });

  it('detecta grupos (capas con capas nombradas anidadas) con sus miembros en orden', () => {
    expect(grupo('t_20_hidrologia:grupo_agua')).toMatchObject({ titulo: 'Agua', resumen: 'Todo el agua' });
    expect(grupo('t_20_hidrologia:grupo_agua').miembros).toEqual([
      { tipo: 'capa', id: 't_20_hidrologia:rios' },
      { tipo: 'capa', id: 't_20_hidrologia:lagos' },
      { tipo: 'grupo', id: 't_20_hidrologia:subgrupo' },
    ]);
  });

  it('resuelve grupos anidados y no cuenta un grupo como capa', () => {
    expect(grupo('t_20_hidrologia:subgrupo').miembros).toEqual([{ tipo: 'capa', id: 't_20_hidrologia:cuencas' }]);
    expect(capa('t_20_hidrologia:subgrupo')).toBeUndefined();
    expect(capas.map((c) => c.id).sort()).toEqual([
      't_20_hidrologia:cuencas', 't_20_hidrologia:lagos', 't_20_hidrologia:rios',
    ]);
  });

  it('no duplica una capa que aparece anidada en varios grupos', () => {
    expect(capas.filter((c) => c.id === 't_20_hidrologia:cuencas')).toHaveLength(1);
  });

  it('un documento sin capas devuelve listas vacías', () => {
    expect(parsearCapacidadesWms('<WMS_Capabilities><Capability/></WMS_Capabilities>')).toEqual({ capas: [], grupos: [] });
  });
});

describe('derivarBaseRest() / derivarBaseOgc()', () => {
  it.each([
    ['https://geo.siatpc.co/geoserver/wms', 'https://geo.siatpc.co/geoserver/rest', 'https://geo.siatpc.co/geoserver'],
    ['https://geo.siatpc.co/geoserver/wms/', 'https://geo.siatpc.co/geoserver/rest', 'https://geo.siatpc.co/geoserver'],
    ['https://geo.siatpc.co/geoserver', 'https://geo.siatpc.co/geoserver/rest', 'https://geo.siatpc.co/geoserver'],
    ['https://geo.siatpc.co/geoserver/ows', 'https://geo.siatpc.co/geoserver/rest', 'https://geo.siatpc.co/geoserver'],
    ['https://geo.test:8443/geoserver/WFS?x=1', 'https://geo.test:8443/geoserver/rest', 'https://geo.test:8443/geoserver'],
    ['https://geo.test', 'https://geo.test/rest', 'https://geo.test'],
  ])('%s', (entrada, rest, ogc) => {
    expect(derivarBaseRest(entrada)).toBe(rest);
    expect(derivarBaseOgc(entrada)).toBe(ogc);
  });
});

describe('listaRest() / parsearGrupoRest()', () => {
  it('normaliza vacío, objeto único y arreglo', () => {
    expect(listaRest('')).toEqual([]);
    expect(listaRest(undefined)).toEqual([]);
    expect(listaRest({ name: 'a' })).toEqual([{ name: 'a' }]);
    expect(listaRest([{ name: 'a' }, { name: 'b' }])).toHaveLength(2);
  });

  it('parsea un grupo de capas con miembros capa y grupo, y modo', () => {
    const detalle = {
      layerGroup: {
        name: 'grupo_agua', mode: 'SINGLE', title: 'Agua', abstractTxt: 'Resumen',
        workspace: { name: 't_20_hidrologia' },
        publishables: { published: [
          { '@type': 'layer', name: 't_20_hidrologia:rios', href: 'https://interna/rest/x' },
          { '@type': 'layerGroup', name: 't_20_hidrologia:sub' },
        ] },
      },
    };
    expect(parsearGrupoRest(detalle)).toEqual({
      id: 't_20_hidrologia:grupo_agua', espacio: 't_20_hidrologia', nombre: 'grupo_agua',
      titulo: 'Agua', resumen: 'Resumen', modo: 'SINGLE',
      miembros: [{ tipo: 'capa', id: 't_20_hidrologia:rios' }, { tipo: 'grupo', id: 't_20_hidrologia:sub' }],
    });
  });

  it('acepta un único publicado y un grupo global sin espacio', () => {
    const g = parsearGrupoRest({ layerGroup: { name: 'base', publishables: { published: { '@type': 'layer', name: 'ws:a' } } } });
    expect(g).toMatchObject({ id: 'base', espacio: null, miembros: [{ tipo: 'capa', id: 'ws:a' }] });
  });

  it('un detalle sin nombre se descarta', () => {
    expect(parsearGrupoRest({ layerGroup: {} })).toBeNull();
  });
});
