import { describe, it, expect } from 'vitest';
import { motivoDeFallo } from '../scripts/biodiversidad/buscar_fotos_especies.mjs';

describe('motivoDeFallo (código de salida de buscar_fotos_especies)', () => {
  it('una corrida con fotos y pocos fallos es válida', () => {
    expect(motivoDeFallo({ fotos: 50, fallos: 5, intentadas: 100 })).toBeNull();
    expect(motivoDeFallo({ fotos: 50, fallos: 20, intentadas: 100 })).toBeNull();
  });

  it('una lista vacía no es válida', () => {
    expect(motivoDeFallo({ fotos: 0, fallos: 0, intentadas: 0 })).toMatch(/vacía/);
  });

  it('más de 20 % de fallos no es válido', () => {
    expect(motivoDeFallo({ fotos: 10, fallos: 21, intentadas: 100 })).toMatch(/21 de 100/);
  });

  it('sin especies intentadas (todo ya resuelto) pero con fotos previas es válido', () => {
    expect(motivoDeFallo({ fotos: 10, fallos: 0, intentadas: 0 })).toBeNull();
  });
});
