import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import logger from '../src/utils/logger.js';
import {
  ACCION,
  registrarCustodia,
  registrarDescarga,
  registrarScanArchivo,
  getCadenaCustodia,
  getDescargasRecurso,
} from '../src/utils/dataCustody.js';

// ─── ACCION constants ─────────────────────────────────────────────────────────

describe('ACCION', () => {
  it('es un objeto frozen con los valores correctos', () => {
    expect(ACCION.INGRESO).toBe('ingreso');
    expect(ACCION.ACTUALIZACION).toBe('actualizacion');
    expect(ACCION.PUBLICACION).toBe('publicacion');
    expect(ACCION.DESPUBLICACION).toBe('despublicacion');
    expect(ACCION.DESCARGA).toBe('descarga');
    expect(ACCION.ELIMINACION).toBe('eliminacion');
    expect(Object.isFrozen(ACCION)).toBe(true);
  });
});

// ─── registrarCustodia() ──────────────────────────────────────────────────────

describe('registrarCustodia()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserta un registro en geo_custodia con todos los parámetros', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarCustodia({
      tipoRecurso: 'mapa',
      recursoId: 'uuid-mapa-1',
      accion: ACCION.INGRESO,
      usuarioId: 'user-uuid',
      usuarioEmail: 'user@iiap.org.co',
      ip: '::ffff:192.168.1.1',
      metadatos: { hash: 'abc123', tamanio: 1024 },
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO geo_custodia/i);
    // ip strip del ::ffff: prefix
    expect(params[5]).toBe('192.168.1.1');
    // metadatos serializado como JSON
    expect(params[6]).toBe(JSON.stringify({ hash: 'abc123', tamanio: 1024 }));
  });

  it('inserta con valores nulos cuando son opcionales', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarCustodia({
      tipoRecurso: 'documento',
      recursoId: 'uuid-doc-1',
      accion: ACCION.PUBLICACION,
    });

    expect(query).toHaveBeenCalledOnce();
    const [, params] = query.mock.calls[0];
    expect(params[3]).toBeNull(); // usuarioId
    expect(params[4]).toBeNull(); // usuarioEmail
    expect(params[5]).toBeNull(); // ip
  });

  it('no lanza si query falla — solo emite warning', async () => {
    query.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      registrarCustodia({ tipoRecurso: 'mapa', recursoId: 'uuid', accion: ACCION.INGRESO })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error registrando custodia'));
  });

  it('maneja IP sin prefijo ::ffff: correctamente', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarCustodia({
      tipoRecurso: 'mapa',
      recursoId: 'uuid',
      accion: ACCION.INGRESO,
      ip: '10.0.0.1',
    });

    const [, params] = query.mock.calls[0];
    expect(params[5]).toBe('10.0.0.1');
  });
});

// ─── registrarDescarga() ──────────────────────────────────────────────────────

describe('registrarDescarga()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserta un registro en descarga_log con todos los parámetros', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarDescarga({
      tipoRecurso: 'mapa',
      recursoId: 'uuid-mapa-1',
      recursoTitulo: 'Mapa Chocó',
      usuarioId: 'user-uuid',
      usuarioEmail: 'user@iiap.org.co',
      ip: '::ffff:10.0.0.2',
      archivoUrl: 'https://files.iiap.gob.co/mapa.pdf',
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO descarga_log/i);
    expect(params[5]).toBe('10.0.0.2'); // ip stripped
    expect(params[6]).toBe('https://files.iiap.gob.co/mapa.pdf');
  });

  it('inserta con valores opcionales nulos', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarDescarga({ tipoRecurso: 'documento', recursoId: 'uuid-doc-1' });

    const [, params] = query.mock.calls[0];
    expect(params[2]).toBeNull(); // recursoTitulo
    expect(params[3]).toBeNull(); // usuarioId
    expect(params[4]).toBeNull(); // usuarioEmail
  });

  it('no lanza si query falla — solo emite warning', async () => {
    query.mockRejectedValueOnce(new Error('DB timeout'));

    await expect(
      registrarDescarga({ tipoRecurso: 'mapa', recursoId: 'uuid' })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error registrando descarga'));
  });
});

// ─── registrarScanArchivo() ───────────────────────────────────────────────────

describe('registrarScanArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserta un scan limpio en file_scan_log', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarScanArchivo({
      archivoKey: 'mapas/uuid-mapa.pdf',
      sha256Hash: 'abc123def456',
      mimeType: 'application/pdf',
      tamanioBytes: 204800,
      uploadedBy: 'user-uuid',
      ipOrigen: '::ffff:192.168.0.1',
      resultado: 'clean',
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO file_scan_log/i);
    expect(params[5]).toBe('192.168.0.1'); // ip stripped
    expect(params[6]).toBe('clean');
    expect(params[7]).toBeNull(); // detalle
  });

  it('inserta un scan rechazado con detalle', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarScanArchivo({
      archivoKey: 'uploads/malware.exe',
      sha256Hash: 'deadbeef',
      mimeType: 'application/pdf',
      tamanioBytes: 512,
      resultado: 'rejected',
      detalle: 'Windows PE/EXE detectado',
    });

    const [, params] = query.mock.calls[0];
    expect(params[6]).toBe('rejected');
    expect(params[7]).toBe('Windows PE/EXE detectado');
  });

  it('usa "clean" como resultado por defecto si no se especifica', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarScanArchivo({
      archivoKey: 'mapas/uuid-mapa.pdf',
      sha256Hash: 'abc123def456',
      mimeType: 'application/pdf',
      tamanioBytes: 204800,
    });

    const [, params] = query.mock.calls[0];
    expect(params[6]).toBe('clean');
  });

  it('no lanza si query falla — solo emite warning', async () => {
    query.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(
      registrarScanArchivo({
        archivoKey: 'file.pdf', sha256Hash: 'abc',
        mimeType: 'application/pdf', tamanioBytes: 100, resultado: 'clean',
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Error registrando scan'));
  });

  it('usa null para ip si no se proporciona', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await registrarScanArchivo({
      archivoKey: 'file.pdf', sha256Hash: 'abc',
      mimeType: 'application/pdf', tamanioBytes: 100, resultado: 'clean',
    });

    const [, params] = query.mock.calls[0];
    expect(params[5]).toBeNull();
  });
});

// ─── getCadenaCustodia() ──────────────────────────────────────────────────────

describe('getCadenaCustodia()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna los registros de custodia del recurso', async () => {
    const ROWS = [
      { id: 1, accion: 'ingreso', usuario_email: 'admin@iiap.org.co', ip: '10.0.0.1', metadatos: {}, created_at: new Date() },
    ];
    query.mockResolvedValueOnce({ rows: ROWS });

    const result = await getCadenaCustodia('mapa', 'uuid-mapa-1');
    expect(result).toEqual(ROWS);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SELECT.*FROM geo_custodia/is);
    expect(params).toEqual(['mapa', 'uuid-mapa-1']);
  });

  it('retorna array vacío si no hay registros', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getCadenaCustodia('documento', 'uuid-doc-X');
    expect(result).toEqual([]);
  });
});

// ─── getDescargasRecurso() ────────────────────────────────────────────────────

describe('getDescargasRecurso()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna los registros de descarga del recurso', async () => {
    const ROWS = [
      { id: 1, usuario_email: 'user@iiap.org.co', ip: '10.0.0.2', archivo_url: 'https://...', created_at: new Date() },
    ];
    query.mockResolvedValueOnce({ rows: ROWS });

    const result = await getDescargasRecurso('mapa', 'uuid-mapa-1');
    expect(result).toEqual(ROWS);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SELECT.*FROM descarga_log/is);
    expect(params).toEqual(['mapa', 'uuid-mapa-1']);
  });

  it('retorna array vacío si no hay descargas', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getDescargasRecurso('documento', 'uuid-doc-X');
    expect(result).toEqual([]);
  });
});
