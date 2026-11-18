import { describe, it, expect } from 'vitest';
import { puedeVerVisibilidad } from '../src/utils/visibilidad.js';

describe('puedeVerVisibilidad()', () => {
  it('el rol publico y el visitante solo ven lo publico (no lo de usuarios)', () => {
    expect(puedeVerVisibilidad('publico', { rol: 'publico' })).toBe(true);
    expect(puedeVerVisibilidad('usuarios', { rol: 'publico' })).toBe(false);
    expect(puedeVerVisibilidad('usuarios', { rol: 'visitante' })).toBe(false);
    expect(puedeVerVisibilidad('usuarios', { tipo: 'visitante', rol: 'investigador' })).toBe(false);
    expect(puedeVerVisibilidad('usuarios', null)).toBe(false);
  });

  it('tecnico e institucional ven todo, igual que en los listados', () => {
    expect(puedeVerVisibilidad('acreditados', { rol: 'tecnico' })).toBe(true);
    expect(puedeVerVisibilidad('acreditados', { rol: 'institucional' })).toBe(true);
  });

  it('un rol sin privilegios especiales ve publico y usuarios pero no acreditados', () => {
    expect(puedeVerVisibilidad('usuarios', { rol: 'otro' })).toBe(true);
    expect(puedeVerVisibilidad('acreditados', { rol: 'otro' })).toBe(false);
  });
});
