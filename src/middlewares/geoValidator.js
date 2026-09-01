/**
 * geoValidator — Validación de metadatos geoespaciales.
 *
 * Garantiza que los recursos cartográficos cargados en VIGIIAP cumplen
 * con los estándares del IGAC (Instituto Geográfico Agustín Codazzi),
 * MAGNA-SIRGAS como CRS oficial de Colombia y los requisitos de
 * documentación mínima exigidos por el IIAP, según la Resolución IGAC
 * 068/2005 (estándares cartográficos nacionales), CONPES 3975
 * (gobernanza del dato público), ISO 19115:2003 (metadatos geográficos)
 * y MAGNA-SIRGAS (Marco de Referencia Geocéntrico para las Américas).
 */

// ─── Sistemas de Referencia de Coordenadas válidos para Colombia ─────────────
const EPSG_COLOMBIA = new Map([
  [4326,  'WGS 84 (geográfico global)'],
  [4686,  'MAGNA-SIRGAS (geográfico nacional — RECOMENDADO)'],
  [3114,  'MAGNA-SIRGAS / Colombia Far West zone'],
  [3115,  'MAGNA-SIRGAS / Colombia West zone'],
  [3116,  'MAGNA-SIRGAS / Colombia Bogota zone'],
  [3117,  'MAGNA-SIRGAS / Colombia East Central zone'],
  [3118,  'MAGNA-SIRGAS / Colombia East zone'],
  [9377,  'MAGNA-SIRGAS / Origen único nacional (recomendado desde 2020)'],
  [32617, 'WGS 84 / UTM zone 17N'],
  [32618, 'WGS 84 / UTM zone 18N'],
  [21896, 'Bogotá 1975 / Colombia West zone (legado)'],
  [21897, 'Bogotá 1975 / Colombia Bogotá zone (legado)'],
  [21898, 'Bogotá 1975 / Colombia East Central zone (legado)'],
]);

// ─── Bounding box del territorio colombiano (WGS84) ──────────────────────────
const COLOMBIA_BBOX = {
  minLon: -82.0, // Incluye zona marina occidental (Isla Malpelo)
  maxLon: -66.0, // Frontera con Venezuela
  minLat:  -5.0, // Zona marina sur
  maxLat:  13.5, // Frontera con Venezuela / mar Caribe
};

const CURRENT_YEAR = new Date().getFullYear();

// ─── Escalas cartográficas habituales del IGAC/IIAP ─────────────────────────
const ESCALAS_COMUNES = [
  1000, 2000, 5000, 10000, 25000, 50000,
  100000, 250000, 500000, 1000000, 5000000,
];

// ─── Validación principal ─────────────────────────────────────────────────────

/**
 * Valida los metadatos geoespaciales de un mapa antes de almacenarlo.
 * @param {object} data  - Campos del formulario (req.body o equivalente)
 * @returns {string[]}   - Array de mensajes de error. Vacío = datos válidos.
 */
export function validateGeoMetadata(data) {
  const errors = [];

  // ── Año de producción cartográfica ──────────────────────────────────────────
  if (data.anio !== undefined && data.anio !== null && data.anio !== '') {
    const anio = Number(data.anio);
    if (!Number.isInteger(anio) || anio < 1950 || anio > CURRENT_YEAR) {
      errors.push(`El año debe estar entre 1950 y ${CURRENT_YEAR} (valor recibido: ${data.anio})`);
    }
  }

  // ── CRS / EPSG ───────────────────────────────────────────────────────────────
  if (data.epsg !== undefined && data.epsg !== null && data.epsg !== '') {
    const epsg = parseInt(data.epsg, 10);
    if (isNaN(epsg)) {
      errors.push('El código EPSG debe ser un número entero (ej: 4686 para MAGNA-SIRGAS)');
    } else if (!EPSG_COLOMBIA.has(epsg)) {
      const listaCRS = [...EPSG_COLOMBIA.entries()]
        .map(([code, name]) => `EPSG:${code} (${name})`)
        .join('\n  ');
      errors.push(
        `EPSG:${epsg} no está en la lista de CRS admitidos para Colombia.\n` +
        `Sistemas permitidos:\n  ${listaCRS}`
      );
    }
  }

  // ── Bounding box ─────────────────────────────────────────────────────────────
  const hasBbox =
    data.bbox_norte !== undefined || data.bbox_sur !== undefined ||
    data.bbox_este  !== undefined || data.bbox_oeste !== undefined;

  if (hasBbox) {
    const norte = parseFloat(data.bbox_norte);
    const sur   = parseFloat(data.bbox_sur);
    const este  = parseFloat(data.bbox_este);
    const oeste = parseFloat(data.bbox_oeste);

    if ([norte, sur, este, oeste].some(isNaN)) {
      errors.push('Si se especifica bbox, los cuatro valores (norte, sur, este, oeste) son obligatorios y deben ser números');
    } else {
      if (norte <= sur) {
        errors.push(`La latitud norte (${norte}) debe ser mayor que la latitud sur (${sur})`);
      }
      if (este <= oeste) {
        errors.push(`La longitud este (${este}) debe ser mayor que la longitud oeste (${oeste})`);
      }
      if (norte > COLOMBIA_BBOX.maxLat || sur < COLOMBIA_BBOX.minLat) {
        errors.push(
          `Las latitudes (${sur}°, ${norte}°) están fuera del territorio colombiano ` +
          `(rango permitido: ${COLOMBIA_BBOX.minLat}° a ${COLOMBIA_BBOX.maxLat}°)`
        );
      }
      if (este > COLOMBIA_BBOX.maxLon || oeste < COLOMBIA_BBOX.minLon) {
        errors.push(
          `Las longitudes (${oeste}°, ${este}°) están fuera del territorio colombiano ` +
          `(rango permitido: ${COLOMBIA_BBOX.minLon}° a ${COLOMBIA_BBOX.maxLon}°)`
        );
      }
    }
  }

  // ── Escala cartográfica ──────────────────────────────────────────────────────
  if (data.escala !== undefined && data.escala !== null && data.escala !== '') {
    const escala = parseInt(data.escala, 10);
    if (isNaN(escala) || escala < 500 || escala > 5_000_000) {
      errors.push(
        `La escala debe ser el denominador entre 500 y 5.000.000 ` +
        `(ej: 25000 para 1:25.000). Escalas comunes: ${ESCALAS_COMUNES.map(e => `1:${e.toLocaleString('es-CO')}`).join(', ')}`
      );
    }
  }

  // ── Fuente institucional ─────────────────────────────────────────────────────
  if (data.fuente !== undefined && data.fuente !== null && data.fuente !== '') {
    if (typeof data.fuente !== 'string' || data.fuente.trim().length < 3) {
      errors.push('La fuente institucional debe tener al menos 3 caracteres');
    }
  }

  return errors;
}

/**
 * Middleware Express: ejecuta validateGeoMetadata sobre req.body.
 * Si hay errores los retorna como 422 con lista de errores.
 */
export function geoValidatorMiddleware(req, res, next) {
  const errors = validateGeoMetadata(req.body);
  if (errors.length > 0) {
    return res.status(422).json({
      error: 'Metadatos geoespaciales inválidos',
      details: errors,
    });
  }
  next();
}

/**
 * Devuelve la lista de CRS permitidos (para formulario frontend).
 */
export function getCRSPermitidos() {
  return [...EPSG_COLOMBIA.entries()].map(([epsg, nombre]) => ({ epsg, nombre }));
}
