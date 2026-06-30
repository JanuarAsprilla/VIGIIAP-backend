/**
 * Tests unitarios para utilidades puras: paginate, slugify.
 * No requieren mocks — son funciones deterministas sin efectos secundarios.
 */
import { describe, it, expect, vi } from 'vitest';
import { paginate } from '../src/utils/paginate.js';
import { slugify } from '../src/utils/slugify.js';

// ─── paginate() ───────────────────────────────────────────────────────────────
describe('paginate()', () => {
  it('usa defaults (page=1, limit=20) cuando no se pasan parámetros', () => {
    const { limit, offset } = paginate({});
    expect(limit).toBe(20);
    expect(offset).toBe(0);
  });

  it('calcula offset correctamente para page=2, limit=10', () => {
    const { limit, offset } = paginate({ page: '2', limit: '10' });
    expect(limit).toBe(10);
    expect(offset).toBe(10);
  });

  it('calcula offset para page=3, limit=5 → offset=10', () => {
    const { offset } = paginate({ page: '3', limit: '5' });
    expect(offset).toBe(10);
  });

  it('fuerza page mínimo a 1 con valores negativos', () => {
    const { offset } = paginate({ page: '-5', limit: '10' });
    expect(offset).toBe(0);
  });

  it('limita el máximo de limit a 100', () => {
    const { limit } = paginate({ limit: '500' });
    expect(limit).toBe(100);
  });

  it('limit=0 usa default 20 (0 es falsy en JS)', () => {
    const { limit } = paginate({ limit: '0' });
    expect(limit).toBe(20); // parseInt('0') || 20 = 20
  });

  it('maneja page=NaN con default 1', () => {
    const { offset } = paginate({ page: 'abc', limit: '10' });
    expect(offset).toBe(0);
  });

  it('maneja limit=NaN con default 20', () => {
    const { limit } = paginate({ limit: 'xyz' });
    expect(limit).toBe(20);
  });

  describe('meta(total)', () => {
    it('retorna campos correctos para primera página', () => {
      const { meta } = paginate({ page: '1', limit: '10' });
      const m = meta(25);
      expect(m.total).toBe(25);
      expect(m.page).toBe(1);
      expect(m.limit).toBe(10);
      expect(m.totalPages).toBe(3);
      expect(m.hasNext).toBe(true);
      expect(m.hasPrev).toBe(false);
    });

    it('última página: hasNext=false, hasPrev=true', () => {
      const { meta } = paginate({ page: '3', limit: '10' });
      const m = meta(25);
      expect(m.hasNext).toBe(false);
      expect(m.hasPrev).toBe(true);
    });

    it('página única: hasNext=false, hasPrev=false', () => {
      const { meta } = paginate({ page: '1', limit: '20' });
      const m = meta(5);
      expect(m.hasNext).toBe(false);
      expect(m.hasPrev).toBe(false);
      expect(m.totalPages).toBe(1);
    });

    it('total=0: totalPages=0', () => {
      const { meta } = paginate({});
      const m = meta(0);
      expect(m.total).toBe(0);
      expect(m.totalPages).toBe(0);
    });

    it('calcula correctamente con limit exacto', () => {
      const { meta } = paginate({ page: '2', limit: '5' });
      const m = meta(10); // 2 páginas exactas
      expect(m.totalPages).toBe(2);
      expect(m.hasNext).toBe(false);
    });
  });
});

// ─── slugify() ────────────────────────────────────────────────────────────────
describe('slugify()', () => {
  it('convierte a minúsculas con guiones', () => {
    expect(slugify('Mapa de Biodiversidad')).toBe('mapa-de-biodiversidad');
  });

  it('elimina tildes (á, é, í, ó, ú)', () => {
    expect(slugify('Área Protegida Amazónica')).toBe('area-protegida-amazonica');
  });

  it('maneja ñ → n', () => {
    expect(slugify('Campaña Nacional')).toBe('campana-nacional');
  });

  it('elimina ú y ó con acento', () => {
    expect(slugify('Río Amazonas 2024')).toBe('rio-amazonas-2024');
  });

  it('maneja mayúsculas completas', () => {
    expect(slugify('ÁREA PROTEGIDA')).toBe('area-protegida');
  });

  it('elimina caracteres especiales pero conserva números', () => {
    expect(slugify('Informe 2024: Avance')).toBe('informe-2024-avance');
  });

  it('genera slug con solo caracteres permitidos (a-z, 0-9, -)', () => {
    const slug = slugify('Sistema de Información Geoespacial del IIAP');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('no deja espacios en el resultado', () => {
    const slug = slugify('Título Con Espacios');
    expect(slug).not.toContain(' ');
  });

  it('maneja texto corto', () => {
    expect(slugify('SIG')).toBe('sig');
  });

  it('maneja números solos', () => {
    expect(slugify('2024')).toBe('2024');
  });
});


// ── notFound middleware ──────────────────────────────────────────────────────
import { notFound } from '../src/middlewares/notFound.js';

describe('notFound middleware', () => {
  it('responds 404 with route info', () => {
    const req = { method: 'GET', originalUrl: '/api/inexistente' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    notFound(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Ruta no encontrada: GET /api/inexistente',
    });
  });

  it('includes method and path in error message', () => {
    const req = { method: 'DELETE', originalUrl: '/api/algo' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    notFound(req, res);
    expect(res.json.mock.calls[0][0].error).toContain('DELETE');
    expect(res.json.mock.calls[0][0].error).toContain('/api/algo');
  });
});
