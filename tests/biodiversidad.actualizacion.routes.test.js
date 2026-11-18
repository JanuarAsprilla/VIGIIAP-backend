import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

const { default: router } = await import('../src/modules/biodiversidad/actualizacion/actualizacion.routes.js');
const { credencialGbifRateLimiter } = await import('../src/middlewares/rateLimiter.js');

describe('rutas de actualización', () => {
  it('PUT /credencial pasa por el límite de tasa antes del controlador', () => {
    const capa = router.stack.find((l) => l.route?.path === '/credencial' && l.route.methods.put);
    const manejadores = capa.route.stack.map((s) => s.handle);
    const i = manejadores.indexOf(credencialGbifRateLimiter);
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(manejadores.length - 1);
  });
});
