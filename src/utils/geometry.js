import * as turf from '@turf/turf';

const HECTAREA_EN_M2 = 10000;

/** Tope de vértices de una geometría de consulta: un polígono dibujado a mano rara vez pasa de unas decenas. */
export const MAX_VERTICES_GEOMETRIA = 1000;

function esCoordenadaValida(punto) {
  return (
    Array.isArray(punto) &&
    punto.length >= 2 &&
    typeof punto[0] === 'number' &&
    typeof punto[1] === 'number' &&
    Number.isFinite(punto[0]) &&
    Number.isFinite(punto[1]) &&
    punto[0] >= -180 &&
    punto[0] <= 180 &&
    punto[1] >= -90 &&
    punto[1] <= 90
  );
}

function esAnilloValido(anillo) {
  if (!Array.isArray(anillo) || anillo.length < 4) return false;
  if (!anillo.every(esCoordenadaValida)) return false;
  const [primero] = anillo;
  const ultimo = anillo[anillo.length - 1];
  return primero[0] === ultimo[0] && primero[1] === ultimo[1];
}

/**
 * Validación estructural de GeoJSON: tipo, anillos cerrados, coordenadas numéricas dentro de
 * rango válido y un máximo de vértices (MAX_VERTICES_GEOMETRIA). No es validación topológica completa (auto-intersección, etc.), pero rechaza
 * cualquier payload malformado antes de que llegue a construir una consulta contra GeoServer.
 */
export function esGeometriaValida(geometria) {
  if (typeof geometria !== 'object' || geometria === null) return false;

  if (geometria.type === 'Polygon') {
    return (
      Array.isArray(geometria.coordinates) &&
      geometria.coordinates.every(esAnilloValido) &&
      contarVertices(geometria.coordinates, 2) <= MAX_VERTICES_GEOMETRIA
    );
  }

  if (geometria.type === 'MultiPolygon') {
    return (
      Array.isArray(geometria.coordinates) &&
      geometria.coordinates.every(
        (poligono) => Array.isArray(poligono) && poligono.every(esAnilloValido),
      ) &&
      contarVertices(geometria.coordinates, 3) <= MAX_VERTICES_GEOMETRIA
    );
  }

  return false;
}

/** Cuenta los vértices de una estructura de anillos con `nivel` capas de anidación (2: Polygon, 3: MultiPolygon). */
function contarVertices(estructura, nivel) {
  if (nivel === 0) return 1;
  return estructura.reduce((total, hijo) => total + contarVertices(hijo, nivel - 1), 0);
}

/** Área geodésica (turf usa una aproximación esférica sobre WGS84). */
export function calcularAreaHectareas(geometria) {
  const areaM2 = turf.area(turf.feature(geometria));
  return areaM2 / HECTAREA_EN_M2;
}

function anilloAWkt(anillo) {
  return `(${anillo.map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`;
}

/** Serializa geometría ya validada a WKT para un CQL_FILTER tipado (nunca texto de usuario). */
export function geometriaAWkt(geometria) {
  if (geometria.type === 'Polygon') {
    return `POLYGON(${geometria.coordinates.map(anilloAWkt).join(', ')})`;
  }
  return `MULTIPOLYGON(${geometria.coordinates
    .map((poligono) => `(${poligono.map(anilloAWkt).join(', ')})`)
    .join(', ')})`;
}
