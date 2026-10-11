import { describe, it, expect } from 'vitest';
import { ejecutarConContexto, contextoActual, asignarUsuarioAlContexto } from '../src/utils/contextoPeticion.js';

describe('contextoPeticion', () => {
  it('no hay contexto fuera de una petición y asignar usuario no falla', () => {
    expect(contextoActual()).toBeUndefined();
    expect(() => asignarUsuarioAlContexto({ id: 'u1' })).not.toThrow();
  });

  it('el contexto sobrevive a lo asíncrono y recibe el usuario', async () => {
    const r = await ejecutarConContexto({ requestId: 'r1' }, async () => {
      await new Promise((ok) => setTimeout(ok, 1));
      asignarUsuarioAlContexto({ id: 'u1', email: 'a@b.co' });
      return contextoActual();
    });
    expect(r).toMatchObject({ requestId: 'r1', usuarioId: 'u1', usuarioEmail: 'a@b.co' });
  });

  it('contextos concurrentes no se mezclan', async () => {
    const leer = (id) => ejecutarConContexto({ requestId: id }, async () => {
      await new Promise((ok) => setTimeout(ok, id === 'a' ? 5 : 1));
      return contextoActual().requestId;
    });
    expect(await Promise.all([leer('a'), leer('b')])).toEqual(['a', 'b']);
  });
});
