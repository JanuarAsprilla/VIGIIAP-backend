import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateGeoMetadata, geoValidatorMiddleware, getCRSPermitidos } from '../src/middlewares/geoValidator.js';

// ─── validateGeoMetadata() ────────────────────────────────────────────────────

describe('validateGeoMetadata() — año de producción', () => {
  it('no reporta error si anio está en rango válido', () => {
    const errors = validateGeoMetadata({ anio: 2020 });
    expect(errors).toHaveLength(0);
  });

  it('no reporta error si anio está vacío (campo opcional)', () => {
    const errors = validateGeoMetadata({ anio: '' });
    expect(errors).toHaveLength(0);
  });

  it('no reporta error si anio es null (campo opcional)', () => {
    const errors = validateGeoMetadata({ anio: null });
    expect(errors).toHaveLength(0);
  });

  it('reporta error si anio < 1950', () => {
    const errors = validateGeoMetadata({ anio: 1949 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/1950/);
  });

  it('reporta error si anio > año actual', () => {
    const errors = validateGeoMetadata({ anio: 9999 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reporta error si anio no es entero', () => {
    const errors = validateGeoMetadata({ anio: 'dos-mil' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateGeoMetadata() — EPSG / CRS', () => {
  it('acepta EPSG 4326 (WGS 84)', () => {
    expect(validateGeoMetadata({ epsg: 4326 })).toHaveLength(0);
  });

  it('acepta EPSG 4686 (MAGNA-SIRGAS)', () => {
    expect(validateGeoMetadata({ epsg: '4686' })).toHaveLength(0);
  });

  it('acepta EPSG 9377 (Origen único nacional)', () => {
    expect(validateGeoMetadata({ epsg: 9377 })).toHaveLength(0);
  });

  it('no reporta error si epsg está vacío', () => {
    expect(validateGeoMetadata({ epsg: '' })).toHaveLength(0);
  });

  it('reporta error si EPSG no está en la lista de Colombia', () => {
    const errors = validateGeoMetadata({ epsg: 4258 }); // ETRS89 — Europa
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/EPSG:4258/);
  });

  it('reporta error si EPSG no es número', () => {
    const errors = validateGeoMetadata({ epsg: 'no-epsg' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/número entero/);
  });
});

describe('validateGeoMetadata() — bounding box', () => {
  const validBbox = {
    bbox_norte: 5.0,
    bbox_sur: 1.0,
    bbox_este: -75.0,
    bbox_oeste: -78.0,
  };

  it('acepta bbox válido dentro de Colombia', () => {
    expect(validateGeoMetadata(validBbox)).toHaveLength(0);
  });

  it('reporta error si norte <= sur', () => {
    const errors = validateGeoMetadata({ ...validBbox, bbox_norte: 1.0, bbox_sur: 5.0 });
    expect(errors.some((e) => e.includes('norte'))).toBe(true);
  });

  it('reporta error si este <= oeste', () => {
    const errors = validateGeoMetadata({ ...validBbox, bbox_este: -80.0, bbox_oeste: -75.0 });
    expect(errors.some((e) => e.includes('este'))).toBe(true);
  });

  it('reporta error si latitudes fuera de Colombia', () => {
    const errors = validateGeoMetadata({ ...validBbox, bbox_norte: 50.0, bbox_sur: 40.0 });
    expect(errors.some((e) => e.includes('latitudes'))).toBe(true);
  });

  it('reporta error si longitudes fuera de Colombia', () => {
    const errors = validateGeoMetadata({ ...validBbox, bbox_este: -30.0, bbox_oeste: -40.0 });
    expect(errors.some((e) => e.includes('longitudes'))).toBe(true);
  });

  it('reporta error si alguno de los 4 valores no es número', () => {
    const errors = validateGeoMetadata({ bbox_norte: 'abc', bbox_sur: 1.0, bbox_este: -75.0, bbox_oeste: -78.0 });
    expect(errors.some((e) => e.includes('cuatro valores'))).toBe(true);
  });

  it('no valida bbox si no hay ninguno de los campos', () => {
    expect(validateGeoMetadata({})).toHaveLength(0);
  });

  it('valida si solo hay bbox_norte (parcial — debe reportar error)', () => {
    const errors = validateGeoMetadata({ bbox_norte: 5.0 });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateGeoMetadata() — escala', () => {
  it('acepta escala 1:25.000 (25000)', () => {
    expect(validateGeoMetadata({ escala: 25000 })).toHaveLength(0);
  });

  it('acepta escala 1:1.000.000 (1000000)', () => {
    expect(validateGeoMetadata({ escala: '1000000' })).toHaveLength(0);
  });

  it('no reporta error si escala está vacía', () => {
    expect(validateGeoMetadata({ escala: '' })).toHaveLength(0);
  });

  it('reporta error si escala < 500', () => {
    const errors = validateGeoMetadata({ escala: 100 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/denominador/);
  });

  it('reporta error si escala > 5.000.000', () => {
    const errors = validateGeoMetadata({ escala: 6000000 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reporta error si escala no es número', () => {
    const errors = validateGeoMetadata({ escala: 'grande' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateGeoMetadata() — fuente institucional', () => {
  it('acepta fuente válida', () => {
    expect(validateGeoMetadata({ fuente: 'IGAC' })).toHaveLength(0);
  });

  it('no reporta error si fuente está vacía', () => {
    expect(validateGeoMetadata({ fuente: '' })).toHaveLength(0);
  });

  it('reporta error si fuente tiene menos de 3 caracteres', () => {
    const errors = validateGeoMetadata({ fuente: 'AB' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/3 caracteres/);
  });

  it('reporta error si fuente no es string', () => {
    const errors = validateGeoMetadata({ fuente: 42 });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateGeoMetadata() — múltiples errores acumulados', () => {
  it('acumula errores de múltiples campos inválidos', () => {
    const errors = validateGeoMetadata({
      anio: 1900,
      epsg: 9999,
      escala: 50,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── geoValidatorMiddleware() ─────────────────────────────────────────────────

describe('geoValidatorMiddleware()', () => {
  const mockNext = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('llama next() si los metadatos son válidos', () => {
    const req = { body: { anio: 2020 } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    geoValidatorMiddleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('retorna 422 con lista de errores si los metadatos son inválidos', () => {
    const req = { body: { anio: 1900, epsg: 9999 } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    geoValidatorMiddleware(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('inválidos'),
        details: expect.any(Array),
      })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('llama next() cuando body está vacío (todos los campos opcionales)', () => {
    const req = { body: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    geoValidatorMiddleware(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });
});

// ─── getCRSPermitidos() ───────────────────────────────────────────────────────

describe('getCRSPermitidos()', () => {
  it('retorna una lista de CRS con epsg y nombre', () => {
    const crs = getCRSPermitidos();
    expect(Array.isArray(crs)).toBe(true);
    expect(crs.length).toBeGreaterThan(0);
    crs.forEach((c) => {
      expect(c).toHaveProperty('epsg');
      expect(c).toHaveProperty('nombre');
      expect(typeof c.epsg).toBe('number');
      expect(typeof c.nombre).toBe('string');
    });
  });

  it('incluye MAGNA-SIRGAS (EPSG 4686)', () => {
    const crs = getCRSPermitidos();
    const sirgas = crs.find((c) => c.epsg === 4686);
    expect(sirgas).toBeTruthy();
    expect(sirgas.nombre).toMatch(/MAGNA-SIRGAS/);
  });
});
