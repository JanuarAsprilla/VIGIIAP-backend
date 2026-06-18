import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../src/modules/auth/auth.schema.js';
import { createSolicitudSchema } from '../src/modules/solicitudes/solicitudes.schema.js';

const baseRegister = {
  nombre: 'Juan Pérez', email: 'juan@iiap.gob.co',
  password: 'Segura123!', tipoAcceso: 'externo',
};

describe('registerSchema — max lengths', () => {
  it('rechaza nombre > 150 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, nombre: 'a'.repeat(151) })).toThrow();
  });
  it('acepta nombre de exactamente 150 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, nombre: 'a'.repeat(150) })).not.toThrow();
  });
  it('rechaza institucion > 300 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, institucion: 'a'.repeat(301) })).toThrow();
  });
  it('acepta institucion de exactamente 300 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, institucion: 'a'.repeat(300) })).not.toThrow();
  });
  it('rechaza motivo > 500 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, motivo: 'a'.repeat(501) })).toThrow();
  });
  it('rechaza email > 254 chars', () => {
    const longEmail = 'a'.repeat(249) + '@ab.co'; // 255 chars total
    expect(() => registerSchema.parse({ ...baseRegister, email: longEmail })).toThrow();
  });
});

describe('loginSchema — max password length', () => {
  it('rechaza password > 72 chars', () => {
    expect(() => loginSchema.parse({ email: 'a@b.co', password: 'A1!a'.repeat(19) })).toThrow();
  });
  it('acepta password de exactamente 72 chars', () => {
    const p = 'Aa1!' + 'x'.repeat(68);
    expect(() => loginSchema.parse({ email: 'a@b.co', password: p })).not.toThrow();
  });
});

describe('createSolicitudSchema — max lengths', () => {
  it('rechaza descripcion > 1000 chars', () => {
    expect(() => createSolicitudSchema.parse({ tipo: 'otro', descripcion: 'a'.repeat(1001) })).toThrow();
  });
  it('acepta descripcion de exactamente 1000 chars', () => {
    expect(() => createSolicitudSchema.parse({ tipo: 'otro', descripcion: 'a'.repeat(1000) })).not.toThrow();
  });
});
