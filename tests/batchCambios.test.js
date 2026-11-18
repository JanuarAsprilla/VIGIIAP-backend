import { describe, it, expect } from 'vitest';
import { cambiosDeLote } from '../src/modules/admin/batchCambios.js';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';

describe('cambiosDeLote()', () => {
  it('registra el rol anterior y el nuevo de cada cuenta', () => {
    const cambios = cambiosDeLote([{ id: A, rol: 'tecnico', activo: true }, { id: B, rol: 'publico', activo: true }], 'cambiar-rol', 'investigador');
    expect(cambios).toEqual({ [A]: { antes: 'tecnico', despues: 'investigador' }, [B]: { antes: 'publico', despues: 'investigador' } });
  });

  it('registra el estado activo anterior y el resultante al activar o desactivar', () => {
    const objetivos = [{ id: A, rol: 'tecnico', activo: false }];
    expect(cambiosDeLote(objetivos, 'activar')).toEqual({ [A]: { antes: false, despues: true } });
    expect(cambiosDeLote(objetivos, 'desactivar')).toEqual({ [A]: { antes: false, despues: false } });
  });
});
