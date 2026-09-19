import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/geovisores/geovisores.service.js', () => ({
  updateThumbnail: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));

import * as geovisorService from '../src/modules/geovisores/geovisores.service.js';
import { uploadThumbnail } from '../src/modules/geovisores/geovisores.controller.js';

const ADMIN = { id: 'a1', email: 'admin@iiap.org.co', rol: 'admin_sig' };

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
const mockNext = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('uploadThumbnail()', () => {
  it('lee thumbnail_url inyectado por el middleware de upload y actualiza el geovisor', async () => {
    const geovisor = { id: 'g1', titulo: 'Geología del Chocó', thumbnailUrl: 'https://files.test.local/new.jpg' };
    geovisorService.updateThumbnail.mockResolvedValue(geovisor);
    const req = { params: { id: 'g1' }, body: { thumbnail_url: 'https://files.test.local/new.jpg' }, user: ADMIN };
    const res = mockRes();

    await uploadThumbnail(req, res, mockNext);

    expect(geovisorService.updateThumbnail).toHaveBeenCalledWith('g1', 'https://files.test.local/new.jpg');
    expect(res.json).toHaveBeenCalledWith(geovisor);
  });

  it('llama next(err) ante error del servicio (ej. 404)', async () => {
    geovisorService.updateThumbnail.mockRejectedValue(Object.assign(new Error('no encontrado'), { status: 404 }));
    const req = { params: { id: 'inexistente' }, body: { thumbnail_url: 'x' }, user: ADMIN };

    await uploadThumbnail(req, mockRes(), mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });
});
