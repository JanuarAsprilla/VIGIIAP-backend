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

function mockReporteQueries({ conteos = CONTEOS_VACIOS, porModulo = [], pendientes = '0', eventosSerie = [] } = {}) {
  query
    .mockResolvedValueOnce({ rows: [conteos] })                    // agregación por acción
    .mockResolvedValueOnce({ rows: porModulo })                    // agregación por módulo
    .mockResolvedValueOnce({ rows: [{ count: pendientes }] })      // solicitudes pendientes (snapshot actual)
    .mockResolvedValueOnce({ rows: eventosSerie });                // eventos crudos para la serie de tiempo
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

describe('admin.service → getReporte() — serie de tiempo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('período "dia" usa granularidad horaria con 24 puntos', async () => {
    mockReporteQueries();
    const result = await getReporte({ periodo: 'dia' });

    expect(result.serieTiempo.granularidad).toBe('hora');
    expect(result.serieTiempo.serie).toHaveLength(24);
    expect(result.serieTiempo.serie[0].etiqueta).toBe('00:00');
    expect(result.serieTiempo.serie[23].etiqueta).toBe('23:00');
  });

  it('período "semana" usa granularidad diaria (un punto por día en el rango)', async () => {
    mockReporteQueries();
    const result = await getReporte({ periodo: 'custom', desde: '2026-08-01', hasta: '2026-08-05' });

    expect(result.serieTiempo.granularidad).toBe('dia');
    expect(result.serieTiempo.serie.map((p) => p.etiqueta)).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
    ]);
  });

  it('cada punto de la serie empieza en cero para las 4 métricas', async () => {
    mockReporteQueries();
    const result = await getReporte({ periodo: 'custom', desde: '2026-08-01', hasta: '2026-08-01' });

    expect(result.serieTiempo.serie).toEqual([
      { etiqueta: '2026-08-01', usuarios: 0, solicitudes: 0, documentos: 0, mapas: 0 },
    ]);
  });

  it('agrupa eventos reales en el día correcto y en la métrica correcta', async () => {
    mockReporteQueries({
      eventosSerie: [
        { accion: 'registro',          creado_en: '2026-08-02T10:00:00' },
        { accion: 'registro',          creado_en: '2026-08-02T15:00:00' },
        { accion: 'create_solicitud',  creado_en: '2026-08-03T09:00:00' },
        { accion: 'publish_documento', creado_en: '2026-08-03T09:30:00' },
        { accion: 'publish_mapa',      creado_en: '2026-08-04T09:30:00' },
      ],
    });
    const result = await getReporte({ periodo: 'custom', desde: '2026-08-01', hasta: '2026-08-05' });

    const porFecha = Object.fromEntries(result.serieTiempo.serie.map((p) => [p.etiqueta, p]));
    expect(porFecha['2026-08-01']).toEqual({ etiqueta: '2026-08-01', usuarios: 0, solicitudes: 0, documentos: 0, mapas: 0 });
    expect(porFecha['2026-08-02']).toEqual({ etiqueta: '2026-08-02', usuarios: 2, solicitudes: 0, documentos: 0, mapas: 0 });
    expect(porFecha['2026-08-03']).toEqual({ etiqueta: '2026-08-03', usuarios: 0, solicitudes: 1, documentos: 1, mapas: 0 });
    expect(porFecha['2026-08-04']).toEqual({ etiqueta: '2026-08-04', usuarios: 0, solicitudes: 0, documentos: 0, mapas: 1 });
  });

  it('agrupa eventos por hora local cuando el período es "dia"', async () => {
    mockReporteQueries({
      eventosSerie: [
        { accion: 'registro', creado_en: new Date(new Date().setHours(9, 15, 0, 0)).toISOString() },
        { accion: 'registro', creado_en: new Date(new Date().setHours(9, 45, 0, 0)).toISOString() },
      ],
    });
    const result = await getReporte({ periodo: 'dia' });

    const punto9am = result.serieTiempo.serie.find((p) => p.etiqueta === '09:00');
    expect(punto9am.usuarios).toBe(2);
  });
});
