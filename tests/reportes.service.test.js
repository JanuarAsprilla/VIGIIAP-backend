/**
 * Tests unitarios para admin.service.js → getReporte()
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('../src/utils/mailer.js', () => ({
  notifyUsuarioCreado: vi.fn().mockResolvedValue(undefined),
  notifyUsuarioActivacion: vi.fn().mockResolvedValue(undefined),
  notifyAdminNewRegistro: vi.fn().mockResolvedValue(undefined),
  notifyRolCambiado: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { getReporte } from '../src/modules/admin/admin.service.js';

const CONTEOS_VACIOS = {
  usuarios_nuevos: '0', usuarios_creados_admin: '0',
  solicitudes_nuevas: '0', solicitudes_resueltas: '0',
  documentos_creados: '0', documentos_publicados: '0',
  mapas_creados: '0', mapas_publicados: '0',
  logins_exitosos: '0', logins_fallidos: '0',
};

function mockReporteQueries({ conteos = CONTEOS_VACIOS, porModulo = [], pendientes = '0' } = {}) {
  query
    .mockResolvedValueOnce({ rows: [conteos] })                    // agregación por acción
    .mockResolvedValueOnce({ rows: porModulo })                    // agregación por módulo
    .mockResolvedValueOnce({ rows: [{ count: pendientes }] });     // solicitudes pendientes (snapshot actual)
}

describe('admin.service → getReporte() — cálculo de rango por período', () => {
  beforeEach(() => vi.clearAllMocks());

  it('período "dia" usa el inicio del día de hoy como "desde"', async () => {
    mockReporteQueries();
    const result = await getReporte({ periodo: 'dia' });
    // sin toISOString() — corre un día en UTC-5
    const ahora = new Date();
    const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    expect(result.desde).toBe(hoy);
    expect(result.hasta).toBe(hoy);
  });

  it('período "custom" sin desde/hasta lanza 400', async () => {
    await expect(getReporte({ periodo: 'custom' })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('período "custom" con desde/hasta usa exactamente ese rango', async () => {
    mockReporteQueries();
    const result = await getReporte({ periodo: 'custom', desde: '2026-08-01', hasta: '2026-08-31' });
    expect(result.desde).toBe('2026-08-01');
    expect(result.hasta).toBe('2026-08-31');
  });

  it('período inválido lanza 400', async () => {
    await expect(getReporte({ periodo: 'decada' })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('admin.service → getReporte() — agregación de métricas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mapea los conteos por acción a la forma esperada por el frontend', async () => {
    mockReporteQueries({
      conteos: {
        usuarios_nuevos: '3', usuarios_creados_admin: '1',
        solicitudes_nuevas: '5', solicitudes_resueltas: '2',
        documentos_creados: '4', documentos_publicados: '2',
        mapas_creados: '1', mapas_publicados: '1',
        logins_exitosos: '20', logins_fallidos: '2',
      },
      pendientes: '3',
    });

    const result = await getReporte({ periodo: 'semana' });

    expect(result.usuarios).toEqual({ nuevos: 3, creadosPorAdmin: 1 });
    expect(result.solicitudes).toEqual({ nuevas: 5, resueltas: 2, pendientes: 3 });
    expect(result.documentos).toEqual({ creados: 4, publicados: 2 });
    expect(result.mapas).toEqual({ creados: 1, publicados: 1 });
    expect(result.logins).toEqual({ exitosos: 20, fallidos: 2 });
  });

  it('mapea la actividad por módulo como arreglo {modulo, total}', async () => {
    mockReporteQueries({
      porModulo: [{ modulo: 'solicitudes', total: '8' }, { modulo: 'auth', total: '22' }],
    });

    const result = await getReporte({ periodo: 'mes' });

    expect(result.actividadPorModulo).toEqual([
      { modulo: 'solicitudes', total: 8 },
      { modulo: 'auth', total: 22 },
    ]);
  });

  it('las solicitudes pendientes son un snapshot actual, no se acotan por rango de fecha', async () => {
    mockReporteQueries({ pendientes: '7' });
    await getReporte({ periodo: 'anio' });

    // La tercera query (pendientes) no debe llevar parámetros de fecha
    const [, params] = query.mock.calls[2];
    expect(params).toBeUndefined();
  });
});
