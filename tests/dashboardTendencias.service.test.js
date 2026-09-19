/**
 * Tests unitarios para admin.service.js → getDashboardTendencias()
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
import { getDashboardTendencias } from '../src/modules/admin/admin.service.js';

/** `diasAtras` eventos hacia atrás desde hoy, a mediodía local (evita líos con DST/medianoche). */
function hace(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

describe('admin.service → getDashboardTendencias()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin eventos en los últimos 14 días: los 4 KPI quedan en cero, deltaPct 0', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await getDashboardTendencias();

    expect(Object.keys(result)).toEqual(['usuarios', 'solicitudes', 'documentos', 'mapas']);
    for (const kpi of Object.values(result)) {
      expect(kpi.semanaActual).toBe(0);
      expect(kpi.semanaAnterior).toBe(0);
      expect(kpi.deltaPct).toBe(0);
      expect(kpi.serie7).toEqual([0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it('separa cada acción en su propio KPI, sin mezclarlas', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { accion: 'registro',          creado_en: hace(0) },
        { accion: 'create_solicitud',  creado_en: hace(1) },
        { accion: 'publish_documento', creado_en: hace(2) },
        { accion: 'publish_mapa',      creado_en: hace(3) },
      ],
    });

    const result = await getDashboardTendencias();

    expect(result.usuarios.semanaActual).toBe(1);
    expect(result.solicitudes.semanaActual).toBe(1);
    expect(result.documentos.semanaActual).toBe(1);
    expect(result.mapas.semanaActual).toBe(1);
  });

  it('semana anterior en cero y semana actual con eventos: delta = 100%', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { accion: 'registro', creado_en: hace(0) },
        { accion: 'registro', creado_en: hace(2) },
      ],
    });

    const result = await getDashboardTendencias();

    expect(result.usuarios.semanaActual).toBe(2);
    expect(result.usuarios.semanaAnterior).toBe(0);
    expect(result.usuarios.deltaPct).toBe(100);
  });

  it('ambas semanas en cero: delta = 0%, no 100%', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getDashboardTendencias();
    expect(result.usuarios.deltaPct).toBe(0);
  });

  it('calcula el delta porcentual redondeado entre semana actual y anterior', async () => {
    const rows = [];
    // Semana anterior (días 8-13 atrás): 4 eventos
    for (let i = 8; i <= 11; i++) rows.push({ accion: 'registro', creado_en: hace(i) });
    // Semana actual (días 0-6 atrás): 6 eventos
    for (let i = 0; i <= 5; i++) rows.push({ accion: 'registro', creado_en: hace(i) });
    query.mockResolvedValueOnce({ rows });

    const result = await getDashboardTendencias();

    expect(result.usuarios.semanaAnterior).toBe(4);
    expect(result.usuarios.semanaActual).toBe(6);
    expect(result.usuarios.deltaPct).toBe(50); // (6-4)/4 * 100
  });

  it('serie7 tiene 7 puntos, el último es "hoy" y refleja el conteo de ese día', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { accion: 'registro', creado_en: hace(0) },
        { accion: 'registro', creado_en: hace(0) },
      ],
    });

    const result = await getDashboardTendencias();

    expect(result.usuarios.serie7).toHaveLength(7);
    expect(result.usuarios.serie7[6]).toBe(2);
  });

  it('ignora filas fuera de la ventana de 14 días sin lanzar error', async () => {
    query.mockResolvedValueOnce({
      rows: [{ accion: 'registro', creado_en: hace(30) }],
    });

    const result = await getDashboardTendencias();

    expect(result.usuarios.semanaActual).toBe(0);
    expect(result.usuarios.semanaAnterior).toBe(0);
  });

  it('consulta audit_log filtrando por las 4 acciones esperadas', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getDashboardTendencias();

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/audit_log/);
    expect(params[1]).toEqual(['registro', 'create_solicitud', 'publish_documento', 'publish_mapa']);
  });
});
