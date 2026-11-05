import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import router from '../src/modules/auth/auth.routes.js';
import { emailActionRateLimiter } from '../src/middlewares/rateLimiter.js';

const manejadoresDe = (ruta, metodo = 'post') => {
  const capa = router.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
  return capa.route.stack.map((s) => s.handle);
};

describe('rutas de auth — límite de correos por destinatario', () => {
  it.each(['/registro', '/reenviar-verificacion'])(
    '%s aplica emailActionRateLimiter: sin él se puede inundar el buzón de un tercero rotando IP',
    (ruta) => {
      expect(manejadoresDe(ruta)).toContain(emailActionRateLimiter);
    },
  );
});
