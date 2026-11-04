import { describe, it, expect, afterEach } from 'vitest';
import {
  cifrarSecretoSmtp, descifrarSecretoSmtp, estaCifradaLaClaveSmtp, cifradoSmtpDisponible,
} from '../src/utils/smtpSecret.js';

const CLAVE = 'ab'.repeat(32);
const original = process.env.SMTP_ENCRYPTION_KEY;
afterEach(() => { if (original === undefined) delete process.env.SMTP_ENCRYPTION_KEY; else process.env.SMTP_ENCRYPTION_KEY = original; });

describe('smtpSecret', () => {
  it('con clave: cifra con prefijo enc1:, no deja la contraseña en claro y se descifra igual', () => {
    process.env.SMTP_ENCRYPTION_KEY = CLAVE;
    const guardado = cifrarSecretoSmtp('mi-clave-smtp');
    expect(guardado).toMatch(/^enc1:[0-9a-f]+:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(guardado).not.toContain('mi-clave-smtp');
    expect(estaCifradaLaClaveSmtp(guardado)).toBe(true);
    expect(descifrarSecretoSmtp(guardado)).toBe('mi-clave-smtp');
  });

  it('dos cifrados de lo mismo difieren (IV aleatorio)', () => {
    process.env.SMTP_ENCRYPTION_KEY = CLAVE;
    expect(cifrarSecretoSmtp('x')).not.toBe(cifrarSecretoSmtp('x'));
  });

  it('sin clave: compatible hacia atrás, se guarda y se lee en claro', () => {
    delete process.env.SMTP_ENCRYPTION_KEY;
    expect(cifradoSmtpDisponible()).toBe(false);
    expect(cifrarSecretoSmtp('plano')).toBe('plano');
    expect(descifrarSecretoSmtp('plano')).toBe('plano');
  });

  it('un valor antiguo en claro se lee tal cual aunque haya clave; una clave inválida no cuenta como clave', () => {
    process.env.SMTP_ENCRYPTION_KEY = CLAVE;
    expect(descifrarSecretoSmtp('clave-antigua')).toBe('clave-antigua');
    process.env.SMTP_ENCRYPTION_KEY = 'corta';
    expect(cifradoSmtpDisponible()).toBe(false);
  });

  it('un valor cifrado sin clave en el servidor falla en vez de enviar basura', () => {
    process.env.SMTP_ENCRYPTION_KEY = CLAVE;
    const guardado = cifrarSecretoSmtp('abc');
    delete process.env.SMTP_ENCRYPTION_KEY;
    expect(() => descifrarSecretoSmtp(guardado)).toThrow(/SMTP_ENCRYPTION_KEY/);
  });

  it('detecta manipulación (etiqueta GCM) y formatos truncados', () => {
    process.env.SMTP_ENCRYPTION_KEY = CLAVE;
    const [p, iv, tag, enc] = cifrarSecretoSmtp('abc').split(':');
    const alterado = `${p}:${iv}:${tag}:${enc.slice(0, -2)}${enc.endsWith('00') ? '11' : '00'}`;
    expect(() => descifrarSecretoSmtp(alterado)).toThrow();
    expect(() => descifrarSecretoSmtp(`${p}:${iv}:${tag.slice(0, 8)}:${enc}`)).toThrow(/formato/);
  });

  it('no cifra dos veces ni valores vacíos', () => {
    process.env.SMTP_ENCRYPTION_KEY = CLAVE;
    const una = cifrarSecretoSmtp('abc');
    expect(cifrarSecretoSmtp(una)).toBe(una);
    expect(cifrarSecretoSmtp('')).toBe('');
  });
});
