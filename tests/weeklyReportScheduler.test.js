import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/modules/admin/admin.service.js', () => ({
  getReporte: vi.fn(),
  getAdminEmails: vi.fn(),
}));

vi.mock('../src/utils/mailer.js', () => ({
  notifyReporteSemanal: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { getReporte, getAdminEmails } from '../src/modules/admin/admin.service.js';
import { notifyReporteSemanal } from '../src/utils/mailer.js';
import {
  runWeeklyReportCheck,
  startWeeklyReportScheduler,
  stopWeeklyReportScheduler,
} from '../src/utils/weeklyReportScheduler.js';

// Lunes 2026-01-05T13:00:00Z — usado como "ahora" en la mayoría de los casos.
const LUNES = new Date('2026-01-05T13:00:00Z');
const MARTES = new Date('2026-01-06T13:00:00Z');

function mockEstado({ activo, ultimoEnvio }) {
  const rows = [];
  if (activo !== undefined) rows.push({ clave: 'reportesSemanal', valor: String(activo) });
  if (ultimoEnvio) rows.push({ clave: 'reportesSemanalUltimoEnvio', valor: ultimoEnvio });
  query.mockResolvedValueOnce({ rows });
}

describe('runWeeklyReportCheck()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReporte.mockResolvedValue({
      desde: '2025-12-29', hasta: '2026-01-05',
      usuarios: { nuevos: 1 }, solicitudes: { nuevas: 1, pendientes: 0 },
      documentos: { publicados: 0 }, mapas: { publicados: 0 },
      logins: { exitosos: 1, fallidos: 0 },
    });
    getAdminEmails.mockResolvedValue(['admin@iiap.gov.co']);
    notifyReporteSemanal.mockResolvedValue(undefined);
  });

  it('no envía nada si reportesSemanal está apagado', async () => {
    mockEstado({ activo: false });
    await runWeeklyReportCheck(LUNES);
    expect(getReporte).not.toHaveBeenCalled();
    expect(notifyReporteSemanal).not.toHaveBeenCalled();
  });

  it('no envía nada si está encendido pero no es lunes', async () => {
    mockEstado({ activo: true });
    await runWeeklyReportCheck(MARTES);
    expect(notifyReporteSemanal).not.toHaveBeenCalled();
  });

  it('envía el reporte a todos los admins si está encendido, es lunes y nunca se ha enviado', async () => {
    mockEstado({ activo: true });
    query.mockResolvedValueOnce({ rows: [] }); // persistirUltimoEnvio

    await runWeeklyReportCheck(LUNES);

    expect(getReporte).toHaveBeenCalledWith({ periodo: 'semana' });
    expect(notifyReporteSemanal).toHaveBeenCalledWith(
      expect.objectContaining({ adminEmail: 'admin@iiap.gov.co' })
    );
  });

  it('no reenvía si el último envío fue hace menos de 6 días', async () => {
    const hace2Dias = new Date(LUNES.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockEstado({ activo: true, ultimoEnvio: hace2Dias });

    await runWeeklyReportCheck(LUNES);

    expect(notifyReporteSemanal).not.toHaveBeenCalled();
  });

  it('vuelve a enviar si pasaron 7 días desde el último envío', async () => {
    const hace7Dias = new Date(LUNES.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    mockEstado({ activo: true, ultimoEnvio: hace7Dias });
    query.mockResolvedValueOnce({ rows: [] }); // persistirUltimoEnvio

    await runWeeklyReportCheck(LUNES);

    expect(notifyReporteSemanal).toHaveBeenCalledOnce();
  });

  it('a un admin que falla no le bloquea el envío a los demás', async () => {
    mockEstado({ activo: true });
    getAdminEmails.mockResolvedValue(['falla@iiap.gov.co', 'ok@iiap.gov.co']);
    notifyReporteSemanal.mockImplementation(({ adminEmail }) =>
      adminEmail === 'falla@iiap.gov.co' ? Promise.reject(new Error('SMTP down')) : Promise.resolve()
    );
    query.mockResolvedValueOnce({ rows: [] }); // persistirUltimoEnvio

    await expect(runWeeklyReportCheck(LUNES)).resolves.toBeUndefined();
    expect(notifyReporteSemanal).toHaveBeenCalledTimes(2);
  });

  it('no lanza si falla la generación del reporte', async () => {
    mockEstado({ activo: true });
    getReporte.mockRejectedValueOnce(new Error('DB fail'));

    await expect(runWeeklyReportCheck(LUNES)).resolves.toBeUndefined();
    expect(notifyReporteSemanal).not.toHaveBeenCalled();
  });

  it('conserva el último estado conocido si la BD falla al recargar, sin lanzar', async () => {
    mockEstado({ activo: false }); // carga inicial exitosa: desactivado
    await runWeeklyReportCheck(LUNES);
    expect(notifyReporteSemanal).not.toHaveBeenCalled();

    query.mockRejectedValueOnce(new Error('DB fail'));
    await expect(runWeeklyReportCheck(LUNES)).resolves.toBeUndefined();
    expect(notifyReporteSemanal).not.toHaveBeenCalled();
  });
});

describe('startWeeklyReportScheduler() / stopWeeklyReportScheduler()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    query.mockResolvedValue({ rows: [{ clave: 'reportesSemanal', valor: 'false' }] });
  });

  afterEach(() => {
    stopWeeklyReportScheduler();
    vi.useRealTimers();
  });

  it('revisa el estado a intervalos regulares', async () => {
    startWeeklyReportScheduler(1000);
    expect(query).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('deja de revisar tras stopWeeklyReportScheduler()', async () => {
    startWeeklyReportScheduler(1000);
    stopWeeklyReportScheduler();

    await vi.advanceTimersByTimeAsync(5000);
    expect(query).not.toHaveBeenCalled();
  });

  it('llamado dos veces no duplica el intervalo', async () => {
    startWeeklyReportScheduler(1000);
    startWeeklyReportScheduler(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
